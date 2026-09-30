import { Agent } from "@earendil-works/pi-agent-core";
import type {
  AgentEvent,
  AgentTool,
  StreamFn,
} from "@earendil-works/pi-agent-core";
import { clampThinkingLevel, contentText } from "@earendil-works/pi-ai";
import type { Api, Model } from "@earendil-works/pi-ai";

import type { AgentThinking } from "./providers.ts";
import {
  assistantEndEvent,
  runEndOf,
  toolEndEvent,
  transcriptEvents,
  userMessage,
  userText,
} from "./transcript.ts";
import type { AgentSessionStore } from "./transcript.ts";
import { AgentEventType, DeltaChannel, RunEndReason } from "./wire.ts";
import type { AgentWireEvent } from "./wire.ts";

/** The model the user configured and the key it runs on. */
export interface AgentModelChoice {
  model: Model<Api>;
  /** Unset when the provider's stored credential, such as a ChatGPT sign-in, authenticates instead. */
  apiKey?: string;
  thinking: AgentThinking;
}

export interface AgentRuntimeOptions {
  store: AgentSessionStore;
  streamFn: StreamFn;
  /** Rejects with a message the user can act on while the model or its key is not set up. */
  model(): Promise<AgentModelChoice>;
  /**
   * The system prompt and tools for one run, built again for every run: skills and the user's
   * instructions are read afresh, and per-run limits start over.
   */
  prepare(sessionId: string): Promise<{
    systemPrompt: string;
    tools: AgentTool[];
  }>;
  onEvent(sessionId: string, event: AgentWireEvent): void;
  now?: () => number;
  createId?: () => string;
}

export interface AgentTurn {
  text: string;
  /** The app's context for the model, from `formatContext`. */
  context: string;
}

interface ActiveRun {
  agent: Agent;
  /** The wire id of the reply that is streaming, if one is. */
  streaming?: string;
  settled: Promise<void>;
}

const TITLE_LENGTH = 60;

function titleOf(text: string): string {
  const [line = ""] = text.trim().split("\n");

  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH)}…` : line;
}

/**
 * Runs conversations on pi's `Agent`, one run per conversation at a time. Every finished message
 * is stored before its event goes out, so a transcript survives the app exiting mid-run and
 * replays through the same fold as the live stream.
 */
export function createAgentRuntime(options: AgentRuntimeOptions) {
  const {
    store,
    onEvent,
    now = Date.now,
    createId = () => crypto.randomUUID(),
  } = options;

  const runs = new Map<string, ActiveRun>();

  function handle(sessionId: string, run: ActiveRun, event: AgentEvent) {
    const emit = (wire: AgentWireEvent) => onEvent(sessionId, wire);

    switch (event.type) {
      case "message_start":
        if (event.message.role === "assistant") {
          run.streaming = createId();
          emit({
            type: AgentEventType.AssistantStart,
            messageId: run.streaming,
          });
        }

        break;

      case "message_update": {
        const update = event.assistantMessageEvent;

        if (!run.streaming) break;

        if (update.type === "text_delta" || update.type === "thinking_delta") {
          emit({
            type: AgentEventType.AssistantDelta,
            messageId: run.streaming,
            channel:
              update.type === "text_delta"
                ? DeltaChannel.Text
                : DeltaChannel.Thinking,
            delta: update.delta,
          });
        }

        break;
      }

      case "message_end": {
        const { message } = event;

        if (message.role === "assistant") {
          const id = run.streaming ?? createId();

          run.streaming = undefined;
          store.append(sessionId, { id, message });
          emit(assistantEndEvent(id, message));
        } else if (message.role === "user") {
          const id = createId();

          store.append(sessionId, { id, message });
          emit({
            type: AgentEventType.User,
            messageId: id,
            text: userText(message),
            at: message.timestamp,
          });
        } else if (message.role === "toolResult") {
          // Its `tool:end` went out when the call finished.
          store.append(sessionId, { id: createId(), message });
        }

        // The system prompt is rebuilt for every run rather than stored.
        break;
      }

      case "tool_execution_start":
        emit({
          type: AgentEventType.ToolStart,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        });
        break;

      case "tool_execution_end":
        emit(
          toolEndEvent({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            isError: event.isError,
            content: event.result.content,
            details: event.result.details,
          })
        );
        break;

      default:
        break;
    }
  }

  async function execute(sessionId: string, run: ActiveRun, turn: AgentTurn) {
    const { agent } = run;

    try {
      await agent.prompt(userMessage(turn.text, turn.context, now()));

      const last = agent.state.messages.at(-1);
      const end = last?.role === "assistant" ? runEndOf(last) : undefined;

      onEvent(
        sessionId,
        end ?? { type: AgentEventType.RunEnd, reason: RunEndReason.Done }
      );
    } catch (error) {
      onEvent(sessionId, {
        type: AgentEventType.RunEnd,
        reason: RunEndReason.Error,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      runs.delete(sessionId);
    }
  }

  /** Resolves once the conversation has no run, stopping one if it is going. */
  async function stop(sessionId: string) {
    const run = runs.get(sessionId);

    run?.agent.abort();
    await run?.settled;
  }

  function claimIdle(sessionId: string) {
    if (runs.has(sessionId)) {
      throw new Error("The agent is still answering in this conversation");
    }
  }

  return {
    isRunning: (sessionId: string) => runs.has(sessionId),

    /** Everything a renderer needs to show the conversation, including a reply still streaming. */
    transcript(sessionId: string): AgentWireEvent[] {
      const run = runs.get(sessionId);

      const events = transcriptEvents(
        store.entries(sessionId),
        run !== undefined
      );

      const partial = run?.agent.state.streamingMessage;

      if (run?.streaming && partial?.role === "assistant") {
        const thinking = partial.content
          .flatMap((part) => (part.type === "thinking" ? [part.thinking] : []))
          .join("");

        events.push(
          { type: AgentEventType.AssistantStart, messageId: run.streaming },
          {
            type: AgentEventType.AssistantDelta,
            messageId: run.streaming,
            channel: DeltaChannel.Thinking,
            delta: thinking,
          },
          {
            type: AgentEventType.AssistantDelta,
            messageId: run.streaming,
            channel: DeltaChannel.Text,
            delta: contentText(partial.content, ""),
          }
        );
      }

      return events;
    },

    /**
     * Starts a run and resolves once it is under way; its progress and outcome arrive as events.
     * Rejects without starting while the conversation is busy or the model is not set up.
     */
    async send(sessionId: string, turn: AgentTurn): Promise<void> {
      claimIdle(sessionId);

      const session = store.get(sessionId);

      if (!session) throw new Error(`Conversation ${sessionId} not found`);

      const [{ model, apiKey, thinking }, { systemPrompt, tools }] =
        await Promise.all([options.model(), options.prepare(sessionId)]);

      // Another send may have started while the model and prompt were prepared.
      claimIdle(sessionId);

      const agent = new Agent({
        initialState: {
          systemPrompt,
          model,
          thinkingLevel: clampThinkingLevel(model, thinking),
          tools,
          messages: store.entries(sessionId).map((entry) => entry.message),
        },
        streamFn: options.streamFn,
        getApiKey: () => apiKey,
        sessionId,
      });

      const run: ActiveRun = { agent, settled: Promise.resolve() };

      runs.set(sessionId, run);
      agent.subscribe((event) => handle(sessionId, run, event));

      store.update({
        ...session,
        title: session.title || titleOf(turn.text),
        updatedAt: now(),
      });

      onEvent(sessionId, { type: AgentEventType.RunStart });
      run.settled = execute(sessionId, run, turn);
    },

    /** Stops a run; what it streamed so far is kept, ending as aborted. */
    abort(sessionId: string) {
      runs.get(sessionId)?.agent.abort();
    },

    stop,

    /** Stops every run, as the app quits, so each transcript ends as aborted rather than cut off. */
    async stopAll() {
      await Promise.all([...runs.keys()].map(stop));
    },
  };
}

export type AgentRuntime = ReturnType<typeof createAgentRuntime>;
