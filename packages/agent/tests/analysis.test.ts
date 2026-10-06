import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { BrokerMode } from "@solyx/core/broker";
import { Interval } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";

import { createAnalysis } from "../src/analysis.ts";
import { AgentThinking } from "../src/providers.ts";
import { createAgentRuntime } from "../src/runtime.ts";
import { createScriptRunner } from "../src/script-runner.ts";
import {
  AgentEventType,
  AgentToolName,
  ToolCallStatus,
  runAnalysisDetailsSchema,
} from "../src/wire.ts";
import type { AgentWireEvent } from "../src/wire.ts";

const DAY = 24 * 60 * 60;

// Thirty daily bars closing at 101, 102, … 130.
const BARS: Candle[] = Array.from({ length: 30 }, (_, index) => ({
  time: 1_750_000_000 + index * DAY,
  open: 100 + index,
  high: 102 + index,
  low: 99 + index,
  close: 101 + index,
  volume: 1000,
}));

const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

/** The agent on the analysis tool alone, running each of `scripts` in one conversation. */
async function analyze(...scripts: string[]) {
  const faux = fauxProvider();
  const models = createModels();
  const events: AgentWireEvent[] = [];
  const candles = vi.fn(async () => BARS);

  models.setProvider(faux.provider);

  const runner = createScriptRunner();

  const analysis = createAnalysis({
    marketData: { candles },
    watchlist: () => [{ market: Market.TW, symbol: "2330" }],
    desk: {
      mode: BrokerMode.Paper,
      account: async () => ({ cash: { TWD: 1_000_000 }, positions: [] }),
    },
    scripts: runner,
  });

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
    tools: async () => ({ offered: [analysis], deferred: [] }),
    onEvent: (_sessionId, event) => events.push(event),
  });

  closers.push(async () => {
    await runtime.close();
    await runner.close();
  });

  faux.setResponses([
    ...scripts.map((code) =>
      fauxAssistantMessage(fauxToolCall(AgentToolName.RunAnalysis, { code }), {
        stopReason: "toolUse",
      })
    ),
    fauxAssistantMessage("Done."),
  ]);

  const { id } = await runtime.create();

  await runtime.send(id, { text: "Analyze", context: "" });
  await vi.waitFor(() =>
    expect(events.at(-1)).toMatchObject({ type: AgentEventType.RunEnd })
  );

  const results = events.flatMap((event) =>
    event.type === AgentEventType.ToolEnd
      ? [
          {
            status: event.status,
            output: runAnalysisDetailsSchema.parse(event.details).output,
          },
        ]
      : []
  );

  return { results, candles };
}

test("a script reads bars and computes with the app's indicators", async () => {
  const { results, candles } = await analyze(`
    const bars = await tools.candles({
      symbol: { market: "${Market.TW}", symbol: "2330" },
      interval: "${Interval.OneDay}",
    });
    const average = await indicators.sma(bars.map((bar) => bar.close), 5);
    text("bars " + bars.length);
    return { last: bars.at(-1).close, sma5: average.at(-1), first: average[0] };
  `);

  expect(candles).toHaveBeenCalledOnce();
  expect(results).toEqual([
    {
      status: ToolCallStatus.Ok,
      output: 'bars 30\nResult: {"last":130,"sma5":128,"first":null}',
    },
  ]);
});

test("what a script stores is there for the conversation's next script", async () => {
  const { results } = await analyze(
    `store("runs", (load("runs") ?? 0) + 1);`,
    `return load("runs");`
  );

  expect(results.map((result) => result.output)).toEqual([
    "The script printed nothing and returned nothing.",
    "Result: 1",
  ]);
});

test("a script reaches nothing outside its sandbox, and its failure is told to the model", async () => {
  const { results } = await analyze(
    `return [typeof fetch, typeof process, typeof require, typeof setTimeout];`,
    `await tools.candles({ symbol: "2330" });`
  );

  expect(results[0]).toEqual({
    status: ToolCallStatus.Ok,
    output: 'Result: ["undefined","undefined","undefined","undefined"]',
  });
  expect(results[1]).toMatchObject({ status: ToolCallStatus.Error });
  expect(results[1]?.output).toContain("symbol");
});
