/**
 * Sends the agent backtest requests a user of the app would write, over Taiwan's real daily bars,
 * and grades each run twice: checks on what it called, and a judge model reading its reply
 * against the request's rubric and the engine's own results. Run from the repository root:
 *
 *   node --env-file=.env packages/agent/scripts/eval-backtests.ts
 *
 * The agent and the judge run on EVAL_MODEL (claude-opus-5-5 unless set), at EVAL_THINKING (medium
 * unless set), through the proxy at EVAL_PROXY_BASE_URL that serves Anthropic's API, on its key
 * EVAL_PROXY_API_KEY; FUGLE_API_KEY reads the bars. EVAL_REQUESTS=a,b runs only
 * those requests, each EVAL_REPEATS times (once unless set), EVAL_AT_ONCE at a time (three unless
 * set, within the provider's rate limits). Each run's transcript and grades are written to
 * EVAL_OUT, a JSON file under the system's temporary folder unless set; it holds market data, so it
 * stays out of the repository. EVAL_REJUDGE names such a file to judge its runs again, as when the
 * judge changes, without running the agent again.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryModelsStore, contentText } from "@earendil-works/pi-ai";
import type { Api, Model } from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { omit, pick, sumBy } from "es-toolkit";
import * as z from "zod";

import type {
  BacktestMetrics,
  BacktestResult,
  BacktestScan,
  RollingResult,
  WalkForwardResult,
} from "@solyx/core/backtest";
import { BrokerMode } from "@solyx/core/broker";
import {
  Interval,
  isCalendarInterval,
  lookbackRange,
  periodStart,
  resampleDaily,
} from "@solyx/core/candles";
import type { BarInterval, Candle } from "@solyx/core/candles";
import { DecisionMode } from "@solyx/core/council";
import { Market, exchangeDate } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { ProposalSource, ProposalStatus } from "@solyx/core/order-desk";
import type { ProposingDesk, TradeProposal } from "@solyx/core/order-desk";
import { getSession, weekdays } from "@solyx/core/session";
import { kernel } from "@solyx/kernel/kernel";
import { createFugleMarketData } from "@solyx/market-data/fugle";

import type { AnalysisSources } from "../src/analysis-sources.ts";
import { createAnalysis } from "../src/analysis.ts";
import { createModelCatalog } from "../src/models.ts";
import { formatContext } from "../src/prompt.ts";
import { AgentThinking, agentThinkingSchema } from "../src/providers.ts";
import { createAgentRuntime } from "../src/runtime.ts";
import { createScriptRunner } from "../src/script-runner.ts";
import type { ScriptRunner } from "../src/script-runner.ts";
import { loadSkillCatalog } from "../src/skills.ts";
import { createTradingExtension } from "../src/tools.ts";
import {
  AgentEventType,
  AgentItemKind,
  AgentToolName,
  foldEvents,
  runAnalysisDetailsSchema,
} from "../src/wire.ts";
import type {
  AgentWireEvent,
  MessageView,
  ReplyUsage,
  ToolCallView,
} from "../src/wire.ts";

import { BACKTEST_REQUESTS, ENGINE_RUBRIC } from "./backtest-requests.ts";
import type { BacktestRequest, Criterion } from "./backtest-requests.ts";

const RUN_TIMEOUT_MS = 15 * 60 * 1000;

// What of a script and an engine call the judge reads, so a long run still fits one request.
const SCRIPT_CHARS = 6000;

const CALLS_SHOWN = 80;

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

// Every request reads the same few listings, so each range is asked for once.
const fetched = new Map<string, Promise<Candle[]>>();

function bars(
  symbol: SymbolRef,
  interval: BarInterval,
  from: string,
  to: string
): Promise<Candle[]> {
  const key = [symbol.market, symbol.symbol, interval, from, to].join("|");
  const known = fetched.get(key);

  if (known) return known;

  const asked = fugle.getCandles({ symbol, interval, from, to });

  fetched.set(key, asked);

  return asked;
}

/** Bars as the app's market data module reads them: weekly and monthly merged from daily ones. */
async function read(
  symbol: SymbolRef,
  interval: Interval,
  from: string,
  to: string
): Promise<Candle[]> {
  if (!isCalendarInterval(interval)) return bars(symbol, interval, from, to);

  return resampleDaily(
    await bars(symbol, Interval.OneDay, periodStart(from, interval), to),
    interval,
    symbol.market
  );
}

const unavailable = (what: string) => async () => {
  throw new Error(`${what} is not set up in this evaluation`);
};

const sources: AnalysisSources = {
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

const skillFolder = await mkdtemp(join(tmpdir(), "solyx-eval-skills-"));

const skills = async () =>
  (
    await loadSkillCatalog(
      { solyx: skillFolder, shared: skillFolder },
      new Set()
    )
  ).skills.filter((skill) => skill.offered);

const LINKS = {
  listing: ({ market, symbol }: SymbolRef, interval: Interval) =>
    `#/symbol/${market}/${symbol}?interval=${interval}`,
  overview: {
    moves: "#/?tab=today",
    headlines: "#/?tab=news",
    calendar: "#/?tab=calendar",
    market: "#/?tab=market",
  },
};

/** A backtest a script ran, alone or as a cell of a scan: what it asked the engine and what came of it. */
interface EngineCall {
  /** The function that ran it. */
  via: string;
  symbol: string;
  interval: Interval;
  since: string | null;
  strategy: unknown;
  split: string | number | null;
  costs: unknown;
  bars: number;
  from: string;
  to: string;
  result: Pick<BacktestResult, "all" | "inSample" | "outOfSample">;
}

/** A scan a script ran, whose cells are among the backtests, and the plateau it picked. */
interface ScanRecord {
  symbol: string;
  cells: number;
  columns: number | null;
  plateau: BacktestScan["plateau"];
}

/** A walk forward a script ran. */
interface WalkRecord {
  symbol: string;
  interval: Interval;
  strategies: number;
  columns: number | null;
  result: Omit<WalkForwardResult, "equity">;
}

/** Rolling windows a script ran. */
interface RollingRecord {
  symbol: string;
  result: RollingResult;
}

/** What the engine ran for a request's scripts, recorded as each call returned. */
interface EngineRecord {
  calls: EngineCall[];
  scans: ScanRecord[];
  walks: WalkRecord[];
  rollings: RollingRecord[];
}

const ENGINE_FUNCTIONS = new Set([
  "backtest.rules",
  "backtest.scan",
  "backtest.walkForward",
  "backtest.rolling",
]);

const engineInputSchema = z.tuple([
  z.object({
    symbol: z.object({ market: z.enum(Market), symbol: z.string() }),
    since: z.string().optional(),
    // Present on backtest.rules alone; zod reads an unknown key as one that must be there.
    strategy: z.unknown().optional(),
    strategies: z.array(z.unknown()).optional(),
    columns: z.number().optional(),
    split: z.union([z.string(), z.number()]).optional(),
    costs: z.unknown().optional(),
  }),
]);

/** The script runner, with every call to the engine recorded as it returns. */
function recordingScripts(record: EngineRecord): ScriptRunner {
  const runner = createScriptRunner();

  return {
    ...runner,
    run: (code, scope) =>
      runner.run(code, {
        ...scope,
        globals: scope.globals?.map((fn) =>
          ENGINE_FUNCTIONS.has(fn.name)
            ? {
                ...fn,
                async execute(args, context) {
                  const result = await fn.execute(args, context);
                  const [input] = engineInputSchema.parse(args);
                  const symbol = input.symbol.symbol;
                  const columns = input.columns ?? null;

                  const asked = {
                    via: fn.name,
                    symbol,
                    since: input.since ?? null,
                    split: input.split ?? null,
                    costs: input.costs ?? null,
                  };

                  if (fn.name === "backtest.rolling") {
                    // SAFETY: the engine's own function returns its RollingResult as it parsed it.
                    record.rollings.push({
                      symbol,
                      result: result as RollingResult,
                    });
                  } else if (fn.name === "backtest.walkForward") {
                    // SAFETY: the engine's own function returns its WalkForwardResult as it parsed it.
                    const walked = result as WalkForwardResult;

                    record.walks.push({
                      symbol,
                      interval: walked.interval,
                      strategies: input.strategies?.length ?? 0,
                      columns,
                      result: omit(walked, ["equity"]),
                    });
                  } else if (fn.name === "backtest.scan") {
                    // SAFETY: the engine's own function returns its BacktestScan as it parsed it.
                    const scan = result as BacktestScan;

                    scan.cells.forEach((cell, index) =>
                      record.calls.push({
                        ...asked,
                        interval: scan.interval,
                        strategy: input.strategies?.[index],
                        bars: scan.bars,
                        from: cell.all.from,
                        to: cell.all.to,
                        result: cell,
                      })
                    );
                    record.scans.push({
                      symbol,
                      cells: scan.cells.length,
                      columns,
                      plateau: scan.plateau,
                    });
                  } else {
                    // SAFETY: the engine's own function returns its BacktestResult as it parsed it.
                    const run = result as BacktestResult;

                    record.calls.push({
                      ...asked,
                      interval: run.interval,
                      strategy: input.strategy,
                      bars: run.bars,
                      from: run.all.from,
                      to: run.all.to,
                      result: pick(run, ["all", "inSample", "outOfSample"]),
                    });
                  }

                  return result;
                },
              }
            : fn
        ),
      }),
  };
}

/** An order desk that keeps nothing and sends nothing: it only records what the agent proposed. */
function recordingDesk(proposals: TradeProposal[]) {
  return {
    mode: BrokerMode.Paper,
    check: async () => [],
    list: () => [],
    account: async () => ({ cash: { TWD: 1_000_000 }, positions: [] }),
    fills: async () => [],
    working: async () => [],
    async propose(input) {
      if (!("order" in input)) {
        throw new Error("The evaluation proposes no exits");
      }

      const { order, rationale } = input;

      const proposal: TradeProposal = {
        id: `p${proposals.length + 1}`,
        broker: "paper",
        mandate: null,
        order,
        source: ProposalSource.Agent,
        rationale,
        basis: null,
        premise: null,
        createdAt: Date.now(),
        status: ProposalStatus.AwaitingConfirmation,
        violations: [],
      };

      proposals.push(proposal);

      return proposal;
    },
  } satisfies ProposingDesk;
}

/** One request's run: the conversation as the app would show it, with what it called. */
interface Run {
  request: BacktestRequest;
  items: ReturnType<typeof foldEvents>["items"];
  ended: string;
  calls: EngineCall[];
  scans: ScanRecord[];
  walks: WalkRecord[];
  rollings: RollingRecord[];
  proposals: TradeProposal[];
  seconds: number;
}

async function runRequest(request: BacktestRequest): Promise<Run> {
  const record: EngineRecord = {
    calls: [],
    scans: [],
    walks: [],
    rollings: [],
  };

  const proposals: TradeProposal[] = [];
  const desk = recordingDesk(proposals);
  const events: AgentWireEvent[] = [];
  const now = new Date();

  const marketData = {
    candles: (symbol: SymbolRef, interval: Interval) => {
      const { from, to } = lookbackRange(symbol.market, interval, now);

      return read(symbol, interval, from, to);
    },
    listing: (symbol: SymbolRef) => fugle.getListing(symbol),
  };

  const trading = createTradingExtension({
    marketData,
    watchlist: () => [],
    news: { collect: unavailable("News") },
    tradingDays: async () => weekdays,
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
    links: LINKS,
    skills,
    instructions: async () => undefined,
  });

  const analysis = createAnalysis({
    ...sources,
    marketData,
    candlesSince: (symbol, interval, since) =>
      read(symbol, interval, since, exchangeDate(symbol.market, now)),
    watchlist: () => [],
    desk,
    scripts: recordingScripts(record),
    kernel,
  });

  let end: (reason: string) => void = () => undefined;
  const ended = new Promise<string>((resolve) => (end = resolve));

  const runtime = createAgentRuntime({
    store: Promise.resolve({
      storage: new MemoryStorage(),
      deleteConversation: async () => undefined,
    }),
    models: catalog.models,
    model: async () => ({ model, thinking }),
    tools: async () => ({ offered: [trading, analysis], deferred: [] }),
    onEvent(_sessionId, event) {
      events.push(event);

      if (event.type === AgentEventType.RunEnd) {
        end(event.error ? `${event.reason}: ${event.error}` : event.reason);
      }
    },
  });

  const started = performance.now();
  const { id } = await runtime.create();

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

  // A pending timer would keep the process up for its whole deadline after the last run.
  clearTimeout(timer);

  await runtime.close();

  return {
    request,
    items: foldEvents(events).items,
    ended: reason,
    ...record,
    proposals,
    seconds: (performance.now() - started) / 1000,
  };
}

const tools = (run: Run) =>
  run.items.filter(
    (item): item is ToolCallView => item.kind === AgentItemKind.Tool
  );

const replies = (run: Run) =>
  run.items.filter(
    (item): item is MessageView => item.kind === AgentItemKind.Assistant
  );

/** What each check on a run found, `null` where it does not apply to the request. */
function checks(run: Run) {
  const engine = run.request.runsEngine;

  return {
    "engine-ran": engine ? run.calls.length > 0 : null,
    "every-call-split": engine
      ? run.calls.length > 0 && run.calls.every((call) => call.split !== null)
      : null,
    "no-proposal": run.proposals.length === 0,
    "skill-read": tools(run).some(
      (tool) =>
        tool.toolName === AgentToolName.ReadSkill &&
        z.object({ name: z.string() }).safeParse(tool.args).data?.name ===
          "backtest"
    ),
  };
}

const verdictsSchema = z.object({
  verdicts: z.array(
    z.object({ id: z.string(), pass: z.boolean(), why: z.string() })
  ),
});

const JUDGE_PROMPT = `You grade one reply of a trading app's analyst agent against a rubric. You get the user's request, the scripts the agent ran with what each printed or returned, every backtest the app's engine ran for it with the engine's own results, and the agent's messages. Judge each criterion alone and strictly, on what the messages and scripts show. The engine's results and what the scripts printed are the truth the reply's figures are checked against; a figure is wrong only where it disagrees with them or is in neither. A trade's return as the engine gives it is after its costs, so it differs a little from its prices' change. Answer with JSON only, no prose and no code fence: {"verdicts":[{"id":"<criterion id>","pass":true|false,"why":"<one sentence, citing the reply>"}]}, one verdict per criterion in the order given.`;

const percent = (value: number | null) =>
  value === null ? "n/a" : `${(value * 100).toFixed(2)}%`;

/** A stretch's record as the judge reads it. */
const stretchText = (metrics: BacktestMetrics | null) =>
  metrics === null
    ? "none"
    : `${metrics.from} to ${metrics.to}: return ${percent(metrics.totalReturn)}, a year ${percent(metrics.annualReturn)}, drawdown ${percent(metrics.maxDrawdown)}, Sharpe ${metrics.sharpe?.toFixed(2) ?? "n/a"}, p-value ${metrics.pValue?.toFixed(3) ?? "n/a"}, ${metrics.trades} trades closed, win rate ${percent(metrics.winRate)}, payoff ${metrics.payoffRatio?.toFixed(2) ?? "n/a"}, exposure ${percent(metrics.exposure)}, buying and holding ${percent(metrics.buyAndHold)} with a drawdown of ${percent(metrics.buyAndHoldDrawdown)}`;

const callText = (call: EngineCall, index: number) =>
  [
    `${index + 1}. ${call.symbol} through ${call.via}, ${call.bars} ${call.interval} bars from ${call.from} to ${call.to}, split ${call.split ?? "none"}, costs ${call.costs === null ? "the app's defaults" : JSON.stringify(call.costs)}`,
    `strategy ${JSON.stringify(call.strategy)}`,
    `all: ${stretchText(call.result.all)}`,
    `in-sample: ${stretchText(call.result.inSample)}`,
    `out-of-sample: ${stretchText(call.result.outOfSample)}`,
  ].join("\n   ");

function judgeInput(run: Run, rubric: Criterion[]): string {
  const scripts = tools(run)
    .filter((tool) => tool.toolName === AgentToolName.RunAnalysis)
    .map((tool, index) => {
      const code = z.object({ code: z.string() }).safeParse(tool.args)
        .data?.code;

      return [
        `--- script ${index + 1} ---`,
        (code ?? "").slice(0, SCRIPT_CHARS),
        `--- what script ${index + 1} printed or returned ---`,
        (
          runAnalysisDetailsSchema.safeParse(tool.details).data?.output ??
          tool.error ??
          ""
        ).slice(0, SCRIPT_CHARS),
      ].join("\n");
    });

  const calls = run.calls.slice(0, CALLS_SHOWN).map(callText);

  const grid = (columns: number | null) =>
    columns === null ? "not laid out as a grid" : `in rows of ${columns}`;

  const scans = run.scans.map(
    (scan, index) =>
      `${index + 1}. ${scan.symbol}, ${scan.cells} strategies ${grid(scan.columns)}: ${scan.plateau === null ? "no plateau" : `plateau at cell ${scan.plateau.cell + 1}, its neighbourhood's mean Sharpe ${scan.plateau.sharpe.toFixed(2)}${scan.plateau.edge ? ", on the grid's edge" : ""}`}`
  );

  const walks = run.walks.map((walk, index) =>
    [
      `${index + 1}. ${walk.symbol}, ${walk.strategies} strategies ${grid(walk.columns)}, efficiency ${walk.result.efficiency?.toFixed(2) ?? "n/a"}`,
      ...walk.result.windows.map(
        (window) =>
          `trained ${window.train.from} to ${window.train.to}, tested ${window.test.from} to ${window.test.to}: ${window.cell === null ? "picked none" : `picked strategy ${window.cell + 1}, training Sharpe ${window.trainSharpe?.toFixed(2) ?? "n/a"}`}`
      ),
      `out-of-sample: ${stretchText(walk.result.outOfSample)}`,
    ].join("\n   ")
  );

  const spreadText = ({
    p10,
    median,
    p90,
  }: RollingResult["summary"]["returns"]) =>
    `10th percentile ${percent(p10)}, median ${percent(median)}, 90th ${percent(p90)}`;

  const rollings = run.rollings.map(({ symbol, result }, index) =>
    [
      `${index + 1}. ${symbol}, ${result.windows.length} windows of ${result.months} months starting every ${result.step}, ${result.interval} bars: beat holding ${percent(result.summary.beatHolding)}, gained ${percent(result.summary.gained)}, about ${result.summary.apart} apart, worst drawdown ${percent(result.summary.worstDrawdown)}, ${result.summary.thin} under 20 trades`,
      `returns: ${spreadText(result.summary.returns)}`,
      `holding: ${spreadText(result.summary.holding)}`,
      `return less holding: ${spreadText(result.summary.excess)}`,
      ...result.windows.map(
        (window) =>
          `${window.from} to ${window.to}: return ${percent(window.totalReturn)}, holding ${percent(window.buyAndHold)}, drawdown ${percent(window.maxDrawdown)}, ${window.trades} trades`
      ),
    ].join("\n   ")
  );

  return [
    `# Request\n${run.request.text}`,
    `# Scripts the agent ran, with what each gave it (${scripts.length})\n${scripts.join("\n") || "none"}`,
    `# Backtests the engine ran, a scan's cells among them (${run.calls.length}${run.calls.length > CALLS_SHOWN ? `, the first ${CALLS_SHOWN} shown` : ""})\n${calls.join("\n") || "none"}`,
    `# Scans' plateaus (${scans.length})\n${scans.join("\n") || "none"}`,
    `# Walk forwards (${walks.length})\n${walks.join("\n") || "none"}`,
    `# Rolling windows (${rollings.length})\n${rollings.join("\n") || "none"}`,
    `# Order proposals the agent made\n${run.proposals.length === 0 ? "none" : JSON.stringify(run.proposals.map(({ order, rationale }) => ({ order, rationale })))}`,
    `# The agent's messages, oldest first\n${replies(run)
      .map((reply) => reply.text)
      .filter(Boolean)
      .join("\n\n---\n\n")}`,
    `# Criteria\n${rubric.map((criterion) => `- ${criterion.id}: ${criterion.text}`).join("\n")}`,
  ].join("\n\n");
}

async function judge(run: Run) {
  const rubric = [
    ...(run.request.runsEngine ? ENGINE_RUBRIC : []),
    ...run.request.rubric,
  ];

  const reply = await catalog.models.completeSimple(model, {
    systemPrompt: JUDGE_PROMPT,
    messages: [
      { role: "user", content: judgeInput(run, rubric), timestamp: Date.now() },
    ],
  });

  const text = contentText(reply.content, "")
    .trim()
    .replace(/^```(?:json)?\s*|\s*```$/g, "");

  const parsed = verdictsSchema.safeParse(JSON.parse(text));

  if (!parsed.success) {
    throw new Error(`The judge answered past its schema: ${text}`);
  }

  return { verdicts: parsed.data.verdicts, cost: reply.usage.cost.total };
}

/** What a run's replies cost at the model's catalog prices. */
function runCost(run: Run, { cost }: Model<Api>) {
  const usage = replies(run).flatMap((reply) =>
    reply.usage ? [reply.usage] : []
  );

  const total = (field: keyof ReplyUsage) =>
    sumBy(usage, (each) => each[field]);

  return {
    tokens: {
      input: total("input"),
      cacheRead: total("cacheRead"),
      cacheWrite: total("cacheWrite"),
      output: total("output"),
    },
    dollars:
      (total("input") * cost.input +
        total("cacheRead") * cost.cacheRead +
        total("cacheWrite") * cost.cacheWrite +
        total("output") * cost.output) /
      1_000_000,
  };
}

const chosen = process.env.EVAL_REQUESTS?.split(",");

const requests = BACKTEST_REQUESTS.filter(
  (request) => !chosen || chosen.includes(request.id)
);

const repeats = z.coerce
  .number()
  .int()
  .positive()
  .parse(process.env.EVAL_REPEATS ?? 1);

const atOnce = z.coerce
  .number()
  .int()
  .positive()
  .parse(process.env.EVAL_AT_ONCE ?? 3);

const queue = requests.flatMap((request) =>
  Array.from({ length: repeats }, () => request)
);

/** Runs kept by an earlier invocation, to be judged again rather than run again. */
async function savedRuns(file: string): Promise<Run[]> {
  // SAFETY: the file is one this script wrote, from the same types, as `graded` below.
  const saved = JSON.parse(await readFile(file, "utf8")) as { run: Run }[];

  return saved.flatMap(({ run }) => {
    const request = requests.find((each) => each.id === run.request.id);

    return request ? [{ ...run, request }] : [];
  });
}

const rejudged = process.env.EVAL_REJUDGE;

console.log(
  `${requests.length} requests, ${repeats} runs each, on ${model.id} (thinking ${thinking}), ${atOnce} at a time\n`
);

const graded: {
  run: Run;
  checks: ReturnType<typeof checks>;
  verdicts: Awaited<ReturnType<typeof judge>>["verdicts"];
  cost: ReturnType<typeof runCost> & { judge: number };
}[] = [];

const runs: (Run | BacktestRequest)[] = rejudged
  ? await savedRuns(rejudged)
  : queue;

for (let index = 0; index < runs.length; index += atOnce) {
  const batch = await Promise.all(
    runs.slice(index, index + atOnce).map(async (each) => {
      const run = "items" in each ? each : await runRequest(each);
      const request = run.request;
      const verdict = await judge(run);

      console.log(
        `${request.id}: ${run.ended} in ${run.seconds.toFixed(0)}s, ${run.calls.length} backtests`
      );

      return {
        run,
        checks: checks(run),
        verdicts: verdict.verdicts,
        cost: { ...runCost(run, model), judge: verdict.cost },
      };
    })
  );

  graded.push(...batch);
}

const dollars = (runs: typeof graded) =>
  sumBy(runs, ({ cost }) => cost.dollars + cost.judge).toFixed(2);

/** Each criterion's passes over a request's runs, with why the first that failed did. */
function tally(runs: typeof graded) {
  const criteria = new Map<
    string,
    { passed: number; of: number; why?: string }
  >();

  const count = (id: string, pass: boolean, why?: string) => {
    const seen = criteria.get(id) ?? { passed: 0, of: 0 };

    criteria.set(id, {
      passed: seen.passed + (pass ? 1 : 0),
      of: seen.of + 1,
      why: seen.why ?? (pass ? undefined : why),
    });
  };

  for (const { checks: found, verdicts } of runs) {
    for (const [id, pass] of Object.entries(found)) {
      if (pass !== null) count(`check ${id}`, pass);
    }

    for (const verdict of verdicts)
      count(verdict.id, verdict.pass, verdict.why);
  }

  return criteria;
}

const totals = { held: { passed: 0, of: 0 }, tuned: { passed: 0, of: 0 } };

console.log("");

for (const request of requests) {
  const runs = graded.filter(({ run }) => run.request === request);
  const total = request.heldOut ? totals.held : totals.tuned;

  console.log(
    `${request.id}${request.heldOut ? " (held out)" : ""}: ${runs.length} runs, $${dollars(runs)}, ${runs.map(({ run }) => run.calls.length).join("/")} backtests, ${sumBy(runs, ({ run }) => run.proposals.length)} proposals`
  );

  for (const [id, { passed, of, why }] of tally(runs)) {
    total.passed += passed;
    total.of += of;

    console.log(
      `  ${passed}/${of} ${id}${why === undefined ? "" : ` — ${why}`}`
    );
  }
}

console.log(
  `\n${totals.tuned.passed}/${totals.tuned.of} passed on the requests the prompt was tuned on, ${totals.held.passed}/${totals.held.of} on those held out, $${dollars(graded)} in all`
);

const out =
  process.env.EVAL_OUT ??
  join(tmpdir(), `solyx-backtest-eval-${Date.now()}.json`);

await writeFile(out, JSON.stringify(graded, null, 2));

console.log(`Transcripts and grades: ${out}`);
