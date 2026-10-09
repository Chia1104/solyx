import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  GenerationTask,
  ToolTask,
  defineExtension,
  hook,
} from "@earendil-works/pi-durable";
import type { Extension, HookApi } from "@earendil-works/pi-durable";
import { ROOT_CONTEXT, SpanStatusCode, trace } from "@opentelemetry/api";
import type { Attributes, Span, Tracer } from "@opentelemetry/api";

import { AgentEventType, RunEndReason } from "./wire.ts";
import type { AgentWireEvent } from "./wire.ts";

// OpenTelemetry's GenAI conventions are incubating, so their names are copied rather than imported.
const ATTR_GEN_AI_OPERATION_NAME = "gen_ai.operation.name";

const ATTR_GEN_AI_AGENT_NAME = "gen_ai.agent.name";

const ATTR_GEN_AI_CONVERSATION_ID = "gen_ai.conversation.id";

const ATTR_GEN_AI_PROVIDER_NAME = "gen_ai.provider.name";

const ATTR_GEN_AI_REQUEST_MODEL = "gen_ai.request.model";

const ATTR_GEN_AI_RESPONSE_MODEL = "gen_ai.response.model";

const ATTR_GEN_AI_RESPONSE_FINISH_REASONS = "gen_ai.response.finish_reasons";

const ATTR_GEN_AI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens";

const ATTR_GEN_AI_USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens";

const ATTR_GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS =
  "gen_ai.usage.cache_read.input_tokens";

const ATTR_GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS =
  "gen_ai.usage.cache_creation.input_tokens";

const ATTR_GEN_AI_TOOL_NAME = "gen_ai.tool.name";

const ATTR_GEN_AI_TOOL_CALL_ID = "gen_ai.tool.call.id";

const ATTR_ERROR_TYPE = "error.type";

/** What pi-ai prices a reply at, in US dollars. */
const ATTR_SOLYX_USAGE_COST = "solyx.usage.cost";

const AGENT_NAME = "Solyx";

/** A run under way: its span, and the requests and tool calls still open under it. */
interface Run {
  span: Span;
  /** By the generation task that asks. */
  requests: Map<string, Span>;
  /** By tool call. */
  tools: Map<string, Span>;
}

function fail(span: Span, type: string) {
  span.setAttribute(ATTR_ERROR_TYPE, type);
  span.setStatus({ code: SpanStatusCode.ERROR });
}

function replyAttributes({
  provider,
  model,
  responseModel,
  stopReason,
  usage,
}: AssistantMessage): Attributes {
  return {
    [ATTR_GEN_AI_PROVIDER_NAME]: provider,
    [ATTR_GEN_AI_REQUEST_MODEL]: model,
    [ATTR_GEN_AI_RESPONSE_MODEL]: responseModel,
    [ATTR_GEN_AI_RESPONSE_FINISH_REASONS]: [stopReason],
    // The prompt is all three, as the conventions count it and the wire's usage does.
    [ATTR_GEN_AI_USAGE_INPUT_TOKENS]:
      usage.input + usage.cacheRead + usage.cacheWrite,
    [ATTR_GEN_AI_USAGE_OUTPUT_TOKENS]: usage.output,
    [ATTR_GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]: usage.cacheRead,
    [ATTR_GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS]: usage.cacheWrite,
    [ATTR_SOLYX_USAGE_COST]: usage.cost.total,
  };
}

/**
 * Traces each run as OpenTelemetry's GenAI conventions name its parts: a span for the run, and
 * under it one for each model request and each tool call. Spans carry identifiers, models and
 * counts, never what the conversation says or a tool was given.
 */
export function createRunTraces(tracer: Tracer) {
  const runs = new Map<string, Run>();

  /** The conversation's run, started here when a request or call reaches the hooks before the run's start is heard. */
  function runOf(conversationId: string): Run {
    const found = runs.get(conversationId);

    if (found) return found;

    const run: Run = {
      span: tracer.startSpan(`invoke_agent ${AGENT_NAME}`, {
        attributes: {
          [ATTR_GEN_AI_OPERATION_NAME]: "invoke_agent",
          [ATTR_GEN_AI_AGENT_NAME]: AGENT_NAME,
          [ATTR_GEN_AI_CONVERSATION_ID]: conversationId,
        },
      }),
      requests: new Map(),
      tools: new Map(),
    };

    runs.set(conversationId, run);

    return run;
  }

  function startUnder(run: Run, name: string, attributes: Attributes) {
    return tracer.startSpan(
      name,
      { attributes },
      trace.setSpan(ROOT_CONTEXT, run.span)
    );
  }

  /** Ends the run with what is still open under it, which a stop or a failure left unanswered. */
  function endRun(conversationId: string, reason: RunEndReason) {
    const run = runs.get(conversationId);

    if (!run) return;

    runs.delete(conversationId);

    for (const span of [...run.requests.values(), ...run.tools.values()]) {
      fail(span, reason);
      span.end();
    }

    if (reason !== RunEndReason.Done) fail(run.span, reason);

    run.span.end();
  }

  const ids = (api: HookApi) => ({
    conversationId: String(api.conversationId),
    taskId: String(api.taskId),
  });

  const extension: Extension = defineExtension({
    name: "traces",
    hooks: [
      hook(GenerationTask, {
        beforeRequest(_request, api) {
          const { conversationId, taskId } = ids(api);
          const run = runOf(conversationId);

          // A retried attempt asks again under the same task.
          run.requests.get(taskId)?.end();
          run.requests.set(
            taskId,
            startUnder(run, "chat", {
              [ATTR_GEN_AI_OPERATION_NAME]: "chat",
              [ATTR_GEN_AI_CONVERSATION_ID]: conversationId,
            })
          );

          return undefined;
        },

        afterResponse(message, api) {
          const { conversationId, taskId } = ids(api);
          const run = runs.get(conversationId);
          const span = run?.requests.get(taskId);

          if (!run || !span) return;

          run.requests.delete(taskId);
          span.updateName(`chat ${message.model}`);
          span.setAttributes(replyAttributes(message));

          if (
            message.stopReason === "error" ||
            message.stopReason === "aborted"
          )
            fail(span, message.stopReason);

          span.end();
        },
      }),
      hook(ToolTask, {
        beforeTool(call, api) {
          const { conversationId } = ids(api);
          const run = runOf(conversationId);

          run.tools.set(
            call.id,
            startUnder(run, `execute_tool ${call.name}`, {
              [ATTR_GEN_AI_OPERATION_NAME]: "execute_tool",
              [ATTR_GEN_AI_TOOL_NAME]: call.name,
              [ATTR_GEN_AI_TOOL_CALL_ID]: call.id,
              [ATTR_GEN_AI_CONVERSATION_ID]: conversationId,
            })
          );

          return undefined;
        },

        afterTool(call, result, api) {
          const run = runs.get(ids(api).conversationId);
          const span = run?.tools.get(call.id);

          if (!run || !span) return undefined;

          run.tools.delete(call.id);

          if (result.isError) fail(span, "tool_error");

          span.end();

          return undefined;
        },
      }),
    ],
  });

  return {
    /** The hooks that time each request and tool call; the host offers it with every run's tools. */
    extension,

    /** Follows a conversation's runs through the events the runtime sends for it. */
    event(sessionId: string, event: AgentWireEvent) {
      if (event.type === AgentEventType.RunStart) runOf(sessionId);
      else if (event.type === AgentEventType.RunEnd)
        endRun(sessionId, event.reason);
    },
  };
}

export type RunTraces = ReturnType<typeof createRunTraces>;
