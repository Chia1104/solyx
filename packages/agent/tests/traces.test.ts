import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { MemoryStorage, defineExtension } from "@earendil-works/pi-durable";
import { SpanStatusCode } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { expect, test, vi } from "vite-plus/test";

import { AgentThinking } from "../src/providers.ts";
import { createAgentRuntime } from "../src/runtime.ts";
import { createRunTraces } from "../src/traces.ts";
import { AgentEventType } from "../src/wire.ts";
import type { AgentWireEvent } from "../src/wire.ts";

function setup() {
  const exporter = new InMemorySpanExporter();

  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  const traces = createRunTraces(provider.getTracer("test"));

  const faux = fauxProvider();
  const models = createModels();

  models.setProvider(faux.provider);

  const events: AgentWireEvent[] = [];

  const runtime = createAgentRuntime({
    store: Promise.resolve({
      storage: new MemoryStorage(),
      deleteConversation: vi.fn(async () => undefined),
    }),
    models,
    model: async () => ({
      model: faux.getModel(),
      thinking: AgentThinking.Off,
    }),
    tools: async () => ({
      offered: [
        defineExtension({
          name: "test",
          tools: [
            {
              name: "get_watchlist",
              description: "The watchlist",
              parameters: { type: "object", properties: {} },
              execute: async () => ({
                content: [{ type: "text", text: "TW 2330" }],
                isError: true,
              }),
            },
          ],
        }),
        traces.extension,
      ],
      deferred: [],
    }),
    onEvent: (sessionId, event) => {
      traces.event(sessionId, event);
      events.push(event);
    },
  });

  const ended = () =>
    vi.waitFor(() =>
      expect(
        events.filter((event) => event.type === AgentEventType.RunEnd)
      ).toHaveLength(1)
    );

  return { exporter, faux, runtime, ended };
}

test("a run is one trace of its model requests and tool calls, which carry counts and never what was said", async () => {
  const { exporter, faux, runtime, ended } = setup();
  const { id } = await runtime.create();

  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("get_watchlist", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("You watch 2330."),
  ]);

  await runtime.send(id, { text: "What do I watch?", context: "time: now" });
  await ended();

  const spans = exporter.getFinishedSpans();
  const run = spans.find(({ name }) => name === "invoke_agent Solyx");
  const model = faux.getModel().id;

  expect(run?.attributes).toMatchObject({ "gen_ai.conversation.id": id });
  expect(run?.status.code).not.toBe(SpanStatusCode.ERROR);
  expect(
    spans
      .filter((span) => span !== run)
      .map((span) => ({
        name: span.name,
        trace: span.spanContext().traceId,
        parent: span.parentSpanContext?.spanId,
      }))
  ).toEqual(
    [`chat ${model}`, "execute_tool get_watchlist", `chat ${model}`].map(
      (name) => ({
        name,
        trace: run?.spanContext().traceId,
        parent: run?.spanContext().spanId,
      })
    )
  );

  const [request] = spans;

  expect(request?.attributes).toMatchObject({
    "gen_ai.operation.name": "chat",
    "gen_ai.provider.name": faux.getModel().provider,
    "gen_ai.request.model": model,
    "gen_ai.response.finish_reasons": ["toolUse"],
    "gen_ai.conversation.id": id,
  });
  expect(request?.attributes["gen_ai.usage.output_tokens"]).toBeTypeOf(
    "number"
  );

  const tool = spans.find(({ name }) => name === "execute_tool get_watchlist");

  expect(tool?.attributes).toMatchObject({
    "gen_ai.tool.name": "get_watchlist",
    "error.type": "tool_error",
  });
  expect(tool?.status.code).toBe(SpanStatusCode.ERROR);

  const recorded = JSON.stringify(spans.map((span) => span.attributes));

  for (const said of ["What do I watch?", "time: now", "TW 2330", "You watch"])
    expect(recorded).not.toContain(said);

  await runtime.close();
});

test("a run that fails ends its trace as failed", async () => {
  const { exporter, faux, runtime, ended } = setup();
  const { id } = await runtime.create();

  faux.setResponses([
    fauxAssistantMessage("", {
      stopReason: "error",
      errorMessage: "invalid x-api-key",
    }),
  ]);

  await runtime.send(id, { text: "hi", context: "" });
  await ended();

  const spans = exporter.getFinishedSpans();

  expect(
    spans.map((span) => ({
      name: span.name,
      error: span.attributes["error.type"],
      status: span.status.code,
    }))
  ).toEqual([
    {
      name: `chat ${faux.getModel().id}`,
      error: "error",
      status: SpanStatusCode.ERROR,
    },
    {
      name: "invoke_agent Solyx",
      error: "error",
      status: SpanStatusCode.ERROR,
    },
  ]);
  expect(JSON.stringify(spans.map((span) => span.attributes))).not.toContain(
    "x-api-key"
  );

  await runtime.close();
});
