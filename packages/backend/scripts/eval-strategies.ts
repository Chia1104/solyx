/**
 * Asks the agent to write strategies a user of the app would ask for, over Taiwan's real daily
 * bars, with the strategy tools, the sandbox and the strategies module the app wires, and checks
 * what it called and what it saved: whether it read the interpreters before writing, checked the
 * lines before backtesting, saved code that reads no later bar, and, where a template says the
 * same, trades as that template does. Run from the repository root:
 *
 *   node --env-file=.env packages/backend/scripts/eval-strategies.ts
 *
 * The agent runs on EVAL_MODEL (claude-opus-5-5 unless set), at EVAL_THINKING (medium unless set),
 * through the proxy at EVAL_PROXY_BASE_URL that serves Anthropic's API, on its key
 * EVAL_PROXY_API_KEY; FUGLE_API_KEY reads the bars. EVAL_REQUESTS=a,b runs only those requests,
 * EVAL_AT_ONCE at a time (two unless set). Each conversation is set to let every call run, so the
 * eval measures the writing, not the asking. The transcripts and checks are written to EVAL_OUT, a
 * JSON file under the system's temporary folder unless set; they hold market data, so they stay
 * out of the repository.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryModelsStore } from "@earendil-works/pi-ai";

import { createAnalysis } from "@solyx/agent/analysis";
import { createModelCatalog } from "@solyx/agent/models";
import { formatContext } from "@solyx/agent/prompt";
import { AgentThinking, agentThinkingSchema } from "@solyx/agent/providers";
import { createAgentRuntime } from "@solyx/agent/runtime";
import { SANDBOX_SUPPORTED, createSandbox } from "@solyx/agent/sandbox";
import { createScriptRunner } from "@solyx/agent/script-runner";
import { loadSkillCatalog } from "@solyx/agent/skills";
import { createStrategyTools } from "@solyx/agent/strategies";
import { createTradingExtension } from "@solyx/agent/tools";
import {
  AgentEventType,
  AgentItemKind,
  AgentToolName,
  ApprovalMode,
  ToolCallStatus,
  foldEvents,
  scriptArgumentsSchema,
} from "@solyx/agent/wire";
import type {
  AgentWireEvent,
  MessageView,
  ToolCallView,
} from "@solyx/agent/wire";
import { backtest } from "@solyx/core/backtest";
import type { RuleSeries, RuleStrategy } from "@solyx/core/backtest";
import { BrokerMode } from "@solyx/core/broker";
import {
  Interval,
  isCalendarInterval,
  lookbackRange,
} from "@solyx/core/candles";
import type { BarInterval } from "@solyx/core/candles";
import { DecisionMode } from "@solyx/core/council";
import { Market, exchangeDate } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { getSession, weekdays } from "@solyx/core/session";
import { openAgentStore } from "@solyx/db/agent";
import { kernel } from "@solyx/kernel/kernel";
import { createFugleMarketData } from "@solyx/market-data/fugle";

import { createSecretStore } from "../src/modules/settings/secret-store.ts";
import { createStrategies } from "../src/modules/strategies/strategies.ts";
import { createStrategyApprovals } from "../src/modules/strategies/strategy-approvals.ts";
import { createStrategyPort } from "../src/modules/strategies/strategy-port.ts";
import { createStrategyRunner } from "../src/modules/strategies/strategy-runner.ts";
import { createStrategySnapshots } from "../src/modules/strategies/strategy-snapshots.ts";

const RUN_TIMEOUT_MS = 20 * 60 * 1000;

const TSMC: SymbolRef = { market: Market.TW, symbol: "2330" };

interface StrategyRequest {
  id: string;
  text: string;
  /** Rules of the engine's own that trade as the strategy should at its initial numbers, any one of them. */
  equivalents?: RuleStrategy[];
  /** Asks for a line that reads later bars, which the agent should neither save nor test as asked. */
  trap?: boolean;
}

const crossing = (fast: RuleSeries, slow: RuleSeries): RuleStrategy => ({
  entry: { crossesAbove: [fast, slow] },
  exit: { crossesBelow: [fast, slow] },
});

const REQUESTS: StrategyRequest[] = [
  {
    id: "close-sma-cross",
    text: "幫我寫一個自己的策略：收盤價向上穿越 20 日均線就買進，向下穿越就賣出，天數可以從 10 調到 60。用台積電 2330 的日線看看。",
    equivalents: [crossing({ price: "close" }, { sma: 20 })],
  },
  {
    id: "channel-breakout",
    text: "寫一個通道突破策略：收盤價高於前 20 天（不含當天）的最高價就買，低於前 20 天的最低價就賣，天數 10 到 60。用 2330 日線跑一下。",
    equivalents: [
      {
        entry: { above: [{ price: "close" }, { highest: 20 }] },
        exit: { below: [{ price: "close" }, { lowest: 20 }] },
      },
      {
        entry: { crossesAbove: [{ price: "close" }, { highest: 20 }] },
        exit: { crossesBelow: [{ price: "close" }, { lowest: 20 }] },
      },
    ],
  },
  {
    id: "centred-mean",
    text: "寫一個策略：收盤價低於 21 日置中移動平均（前後各 10 天）時買進，高於時賣出，用 2330 日線回測看看。",
    trap: true,
  },
  {
    id: "atr-breakout",
    text: "幫我寫一個 ATR 突破策略：收盤價高於前 20 天最高價再加 1.5 倍的 20 日平均振幅（最高減最低）就買，跌破 40 日均線就賣，停損 8%。天數和倍數都要能調。在 2330 日線上看看。",
  },
  {
    id: "zscore-reversion",
    text: "用 z-score 寫一個均值回歸策略：收盤價相對 20 日均值和標準差的 z-score 跌破 -2 就買，回到 0 以上就賣，在 2330 日線上測試。",
  },
];

const apiKey = process.env.EVAL_PROXY_API_KEY;

const baseUrl = process.env.EVAL_PROXY_BASE_URL;

const fugleKey = process.env.FUGLE_API_KEY;

if (!apiKey || !baseUrl || !fugleKey) {
  throw new Error(
    "Set EVAL_PROXY_API_KEY, EVAL_PROXY_BASE_URL and FUGLE_API_KEY, as in .env"
  );
}

const catalog = createModelCatalog({
  credentials: {
    read: async (provider) =>
      provider === "anthropic" ? { type: "api_key", key: apiKey } : undefined,
    stored: async (provider) =>
      provider === "anthropic" ? "api_key" : undefined,
    modify: async () => undefined,
    delete: async () => undefined,
  },
  appName: "Solyx",
  getDeviceId: () => "00000000-0000-4000-8000-000000000000",
  openExternal: () => undefined,
  endpoint: (provider) => (provider === "anthropic" ? baseUrl : undefined),
  modelsStore: new InMemoryModelsStore(),
});

const modelId = process.env.EVAL_MODEL ?? "claude-opus-5-5";

const found = await catalog.model("anthropic", modelId);

if (!found || found.id !== modelId) {
  throw new Error(`Anthropic has no model ${modelId} in pi-ai's catalog`);
}

const model = found;

const thinking = agentThinkingSchema.parse(
  process.env.EVAL_THINKING ?? AgentThinking.Medium
);

const fugle = createFugleMarketData({ apiKey: fugleKey });

const fetched = new Map<string, ReturnType<typeof fugle.getCandles>>();

/** Bars read once a range, since every request reads the same listing. */
function read(
  symbol: SymbolRef,
  interval: BarInterval,
  from: string,
  to: string
) {
  const key = [symbol.market, symbol.symbol, interval, from, to].join("|");

  const known =
    fetched.get(key) ?? fugle.getCandles({ symbol, interval, from, to });

  fetched.set(key, known);

  return known;
}

const now = new Date();

/** Daily bars and shorter, which the requests ask for; weekly and monthly are merged in the app. */
function readBars(
  symbol: SymbolRef,
  interval: Interval,
  from: string,
  to: string
) {
  if (isCalendarInterval(interval)) {
    throw new Error("This evaluation reads daily bars and shorter");
  }

  return read(symbol, interval, from, to);
}

const marketData = {
  candles: (symbol: SymbolRef, interval: Interval) => {
    const { from, to } = lookbackRange(symbol.market, interval, now);

    return readBars(symbol, interval, from, to);
  },
  listing: (symbol: SymbolRef) => fugle.getListing(symbol),
};

const unavailable = (what: string) => async () => {
  throw new Error(`${what} is not set up in this evaluation`);
};

const sources = {
  quote: async () => null,
  sectors: async () => null,
  flows: { listing: unavailable("Flows") },
  fundamentals: {
    statements: unavailable("Fundamentals"),
    monthlyRevenue: unavailable("Fundamentals"),
    multiples: unavailable("Fundamentals"),
    dividends: unavailable("Fundamentals"),
    company: unavailable("Fundamentals"),
  },
};

const desk = {
  mode: BrokerMode.Paper,
  check: async () => [],
  list: () => [],
  account: async () => ({ cash: { TWD: 1_000_000 }, positions: [] }),
  fills: async () => [],
  working: async () => [],
  propose: unavailable("Proposing"),
};

// A cipher that keeps the approvals in a folder of the eval's own, which only it reads.
const cipher = {
  isAvailable: async () => true,
  encrypt: async (plainText: string) => Buffer.from(plainText),
  decrypt: async (encrypted: Buffer) => ({
    plainText: encrypted.toString(),
    shouldReEncrypt: false,
  }),
};

const sandbox = SANDBOX_SUPPORTED
  ? createSandbox({ home: homedir(), appFolders: [] })
  : undefined;

/** One request's run: the conversation, and the strategies module its tools wrote through. */
async function runRequest(request: StrategyRequest) {
  const directory = await mkdtemp(join(tmpdir(), `solyx-eval-${request.id}-`));
  const folder = join(directory, "strategies");

  const strategies = createStrategies({
    folder,
    runner: createStrategyRunner({
      runs: join(directory, "runs"),
      sandbox,
      sandboxed: () => sandbox !== undefined,
      path: async () => process.env.PATH,
    }),
    approvals: createStrategyApprovals(
      createSecretStore(join(directory, "secrets.json"), cipher)
    ),
    snapshots: createStrategySnapshots(join(directory, "versions")),
    reach: () => ({ sandboxed: sandbox !== undefined, live: false }),
    showItemInFolder: () => undefined,
    trashItem: async () => undefined,
    onChange: () => undefined,
  });

  const port = createStrategyPort(strategies, async () => undefined);
  const tools = createStrategyTools(port);
  const skillFolder = join(directory, "skills");

  const skills = async () =>
    (
      await loadSkillCatalog(
        { solyx: skillFolder, shared: skillFolder },
        new Set()
      )
    ).skills.filter((skill) => skill.offered);

  const trading = createTradingExtension({
    marketData,
    watchlist: () => [],
    news: { collect: unavailable("News") },
    exchangeRate: unavailable("The exchange rate"),
    tradingDays: async () => weekdays,
    searchListings: async () => ({ matches: [], unread: [] }),
    calendar: async () => ({
      events: [],
      research: [],
      unread: [],
      releases: [],
      closures: [],
      unreadMarkets: [],
    }),
    figures: async () => [],
    desk,
    links: {
      listing: ({ market, symbol }, interval) =>
        `#/symbol/${market}/${symbol}?interval=${interval}`,
      overview: (place, market) =>
        `#/?tab=${place}${market ? `&market=${market}` : ""}`,
      strategy: (name) => `#/strategies/${name}`,
    },
    skills,
    instructions: async () => undefined,
  });

  const analysis = createAnalysis({
    ...sources,
    marketData,
    candlesSince: (symbol, interval, since) =>
      readBars(symbol, interval, since, exchangeDate(symbol.market, now)),
    watchlist: () => [],
    desk,
    strategies: port,
    scripts: createScriptRunner(),
    kernel,
  });

  const events: AgentWireEvent[] = [];
  let end: (reason: string) => void = () => undefined;
  const ended = new Promise<string>((resolve) => (end = resolve));

  const runtime = createAgentRuntime({
    store: openAgentStore(join(directory, "agent.sqlite")),
    models: catalog.models,
    model: async () => ({ model, thinking }),
    async tools({ guard }) {
      const listed = (await port.catalog()).strategies.length > 0;

      return {
        offered: [trading, analysis, tools.extension(guard, listed)],
        deferred: [],
      };
    },
    onEvent(_sessionId, event) {
      events.push(event);

      if (event.type === AgentEventType.RunEnd) {
        end(event.error ? `${event.reason}: ${event.error}` : event.reason);
      }
    },
  });

  const started = performance.now();
  const { id } = await runtime.create();

  await runtime.setApprovalMode(id, ApprovalMode.Bypass);
  await runtime.send(id, {
    text: request.text,
    context: formatContext({
      now,
      sessions: {
        [Market.TW]: getSession(Market.TW, now),
        [Market.US]: getSession(Market.US, now),
      },
      brokerMode: BrokerMode.Paper,
      locale: "zh-TW",
      timeZone: "Asia/Taipei",
      decisionMode: DecisionMode.Single,
    }),
  });

  let timer: ReturnType<typeof setTimeout> | undefined;

  const reason = await Promise.race([
    ended,
    new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve("timed out"), RUN_TIMEOUT_MS);
    }),
  ]);

  clearTimeout(timer);
  await runtime.close();

  return {
    request,
    strategies,
    items: foldEvents(events).items,
    ended: reason,
    seconds: Math.round((performance.now() - started) / 1000),
  };
}

type Run = Awaited<ReturnType<typeof runRequest>>;

const toolCalls = (run: Run) =>
  run.items.filter(
    (item): item is ToolCallView => item.kind === AgentItemKind.Tool
  );

/** The code of each script the run sent, in order. */
const scripts = (run: Run) =>
  toolCalls(run).flatMap((call) =>
    call.toolName === AgentToolName.RunAnalysis
      ? [scriptArgumentsSchema.safeParse(call.args).data?.code ?? ""]
      : []
  );

const BACKTESTING = /strategies\.(backtest|scan|walkForward|rolling)\(/;

/** The trades' bars, by when each bought and sold, which two runs of the same rules share. */
const tradeTimes = (result: Awaited<ReturnType<typeof backtest>>) =>
  result.trades.map((trade) => `${trade.entryTime}→${trade.exitTime}`);

/** What each check on a run found, `null` where it does not apply to the request. */
async function checks(run: Run) {
  const calls = toolCalls(run);

  const first = (name: AgentToolName) =>
    calls.findIndex((call) => call.toolName === name);

  const saves = calls.filter(
    (call) =>
      call.toolName === AgentToolName.SaveStrategy &&
      call.status === ToolCallStatus.Ok
  );

  const code = scripts(run);
  const linesAt = code.findIndex((each) => each.includes("strategies.lines("));
  const backtestAt = code.findIndex((each) => BACKTESTING.test(each));

  const { strategies: written } = await run.strategies.catalog();
  const strategy = written.at(-1);

  const reply = run.items
    .filter(
      (item): item is MessageView => item.kind === AgentItemKind.Assistant
    )
    .at(-1)?.text;

  const called = {
    "runtimes-before-save": run.request.trap
      ? null
      : first(AgentToolName.GetRuntimes) !== -1 &&
        first(AgentToolName.GetRuntimes) < first(AgentToolName.SaveStrategy),
    saved: run.request.trap ? null : saves.length > 0 && strategy !== undefined,
    "lines-before-backtest": run.request.trap
      ? null
      : linesAt !== -1 && (backtestAt === -1 || linesAt <= backtestAt),
    "said-it-reads-ahead": run.request.trap
      ? /未來|之後|前視|look-?ahead/i.test(reply ?? "")
      : null,
  };

  if (!strategy) {
    return {
      found: {
        ...called,
        "no-look-ahead": run.request.trap ? true : null,
        "trades-as-template": null,
      },
      versions: saves.length,
      reply,
    };
  }

  const bars = await marketData.candles(TSMC, Interval.OneDay);
  let worked: Awaited<ReturnType<typeof run.strategies.lines>>;

  try {
    worked = await run.strategies.lines(
      strategy.name,
      TSMC,
      bars,
      { interval: Interval.OneDay },
      [{}]
    );
  } catch (error) {
    return {
      found: { ...called, "no-look-ahead": false, "trades-as-template": null },
      versions: saves.length,
      reply,
      strategy,
      failed: String(error),
    };
  }

  const own = tradeTimes(
    await backtest(kernel, TSMC, bars, worked.rules, { lines: worked.lines[0] })
  );

  const matches = await Promise.all(
    (run.request.equivalents ?? []).map(
      async (rules) =>
        tradeTimes(await backtest(kernel, TSMC, bars, rules)).join() ===
        own.join()
    )
  );

  return {
    found: {
      ...called,
      "no-look-ahead": worked.lookAhead === null,
      "trades-as-template": run.request.equivalents
        ? matches.some(Boolean)
        : null,
    },
    versions: saves.length,
    reply,
    strategy,
    params: worked.params,
    trades: own.length,
  };
}

const wanted = process.env.EVAL_REQUESTS?.split(",");

const atOnce = Number(process.env.EVAL_AT_ONCE ?? 2);

const requests = REQUESTS.filter((each) => !wanted || wanted.includes(each.id));

const results: unknown[] = [];

for (let start = 0; start < requests.length; start += atOnce) {
  const runs = await Promise.all(
    requests.slice(start, start + atOnce).map(runRequest)
  );

  for (const run of runs) {
    const checked = await checks(run);

    console.log(
      `${run.request.id} (${run.seconds} s, ${run.ended}): ${JSON.stringify(checked.found)}, ${checked.versions} versions saved`
    );

    results.push({
      id: run.request.id,
      ended: run.ended,
      seconds: run.seconds,
      ...checked,
      calls: toolCalls(run).map((call) => ({
        tool: call.toolName,
        status: call.status,
        args: call.args,
        error: call.error,
      })),
    });
  }
}

await sandbox?.close();

const out =
  process.env.EVAL_OUT ??
  join(await mkdtemp(join(tmpdir(), "solyx-eval-")), "strategies.json");

await writeFile(out, JSON.stringify(results, null, 2));

console.log(`Wrote ${out}`);
