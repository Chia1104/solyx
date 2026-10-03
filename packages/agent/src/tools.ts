import type { Context, JsonValue } from "@earendil-works/chord";
import {
  LiveDoc,
  defineDoc,
  defineExtension,
} from "@earendil-works/pi-durable";
import type {
  Extension,
  ToolExecutionApi,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import { maxBy, omit, takeRight, uniq } from "es-toolkit";
import * as z from "zod";

import type { BrokerMode } from "@solyx/core/broker";
import {
  candleDate,
  intervalSchema,
  isIntraday,
  lookbackRange,
} from "@solyx/core/candles";
import type { Candle, Interval } from "@solyx/core/candles";
import {
  MOVING_AVERAGE_PERIODS,
  bollinger,
  ema,
  kd,
  macd,
  rsi,
  sma,
} from "@solyx/core/indicators";
import type { IndicatorLine } from "@solyx/core/indicators";
import {
  Market,
  exchangeTime,
  instrumentKindSchema,
  marketSchema,
  symbolRefSchema,
} from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { MarketDataProvider } from "@solyx/core/market-data";
import {
  NewsChannel,
  NewsVoice,
  collectNews,
  dailySentiment,
  isAboutListing,
  sentimentGauge,
} from "@solyx/core/news";
import type { NewsSource, NewsStore, NewsStory } from "@solyx/core/news";
import { OrderType, sideSchema } from "@solyx/core/order";
import type { AccountSnapshot, OrderRequest } from "@solyx/core/order";
import { ProposalSource } from "@solyx/core/order-desk";
import type { OrderDesk, TradeProposal } from "@solyx/core/order-desk";
import { stanceValue } from "@solyx/core/sentiment";
import type { SentimentScorer } from "@solyx/core/sentiment";
import { getSession } from "@solyx/core/session";
import { errorMessage } from "@solyx/utils/error";

import { promptSections } from "./prompt.ts";
import type { PromptSources } from "./prompt.ts";
import { AgentToolName } from "./wire.ts";
import type { ProposeOrderDetails } from "./wire.ts";

/** What the tools and the prompt read, and the one thing the tools may do: propose. */
export interface TradingToolPorts extends PromptSources {
  /** The market's provider, or `undefined` when no source covers it or its settings are incomplete. */
  marketData(market: Market): Promise<MarketDataProvider | undefined>;
  watchlist(): SymbolRef[];
  /** The sources the user can search; one that needs a key joins once it is saved. */
  newsSources(): Promise<NewsSource[]>;
  newsStore: NewsStore;
  /** Judges what news says about a listing; `undefined` until the user saves a decisions model's key. */
  scorer(): Promise<SentimentScorer | undefined>;
  account(): Promise<AccountSnapshot>;
  brokerMode: BrokerMode;
  desk: Pick<OrderDesk, "check" | "propose" | "list">;
  now?: () => Date;
}

interface ToolOutput {
  /** What the model reads. */
  text: string;
  /** What the renderer shows. */
  details?: JsonValue;
}

interface ToolSpec<Parameters extends z.ZodObject> {
  name: AgentToolName;
  description: string;
  parameters: Parameters;
  /**
   * `safe` lets a call the app's exit cut off run again when the app reopens: only for calls that
   * change nothing, or whose change running twice cannot repeat. Otherwise the model is told the
   * call was interrupted.
   */
  replay: ToolRegistration["replay"];
  execute(
    params: z.infer<Parameters>,
    api: ToolExecutionApi,
    context: Context
  ): Promise<ToolOutput>;
}

/**
 * pi validates the model's arguments against the JSON Schema before `execute`; parsing them
 * again with zod types them and applies what JSON Schema cannot express.
 */
function defineTool<Parameters extends z.ZodObject>(
  spec: ToolSpec<Parameters>
): ToolRegistration {
  return {
    name: spec.name,
    description: spec.description,
    // Providers read the schema inline; the dialect URI is noise to them.
    parameters: omit(z.toJSONSchema(spec.parameters, { io: "input" }), [
      "$schema",
    ]),
    replay: spec.replay,
    async execute(params, api, context) {
      const parsed = spec.parameters.safeParse(params);

      if (!parsed.success) throw new Error(z.prettifyError(parsed.error));

      const { text, details } = await spec.execute(parsed.data, api, context);

      return { content: [{ type: "text", text }], details };
    },
  };
}

/** The run that made the conversation's proposal, and the call that made it. */
const ProposalClaimDoc = defineDoc<{
  claim: { run: number | null; callId: string } | null;
}>({
  kind: "solyx.proposal-claim",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ claim: null }),
});

const MAX_BARS = 200;

const LISTED_PROPOSALS = 20;

// Per source and per channel.
const NEWS_ITEMS = 10;

// Announcements run long; the scorer reads them whole.
const SNIPPET_LENGTH = 280;

// Requests to the decisions model at once.
const SCORING_CONCURRENCY = 4;

const DAY_MS = 24 * 60 * 60 * 1000;

const valueAt = (line: IndicatorLine, offset: number) => {
  const value = line.at(offset);

  return value === null || value === undefined
    ? "n/a"
    : Number(value.toPrecision(8));
};

const orderSchema = z.object({
  market: marketSchema,
  symbol: symbolRefSchema.shape.symbol.describe(
    "Exchange code, such as 2330 or AAPL"
  ),
  kind: instrumentKindSchema,
  side: sideSchema,
  quantity: z
    .number()
    .int()
    .positive()
    .describe("Shares, not lots: two Taiwan board lots are 2000"),
  type: z.enum(OrderType),
  limitPrice: z
    .number()
    .positive()
    .optional()
    .describe("Required for limit orders, on the market's tick grid"),
});

function toOrderRequest(order: z.infer<typeof orderSchema>): OrderRequest {
  const instrument = {
    market: order.market,
    symbol: order.symbol,
    kind: order.kind,
  };

  if (order.type === OrderType.Market) {
    return {
      instrument,
      side: order.side,
      quantity: order.quantity,
      type: OrderType.Market,
    };
  }

  if (order.limitPrice === undefined) {
    throw new Error("A limit order needs limitPrice");
  }

  return {
    instrument,
    side: order.side,
    quantity: order.quantity,
    type: OrderType.Limit,
    limitPrice: order.limitPrice,
  };
}

/** The option with the highest probability. */
const likeliest = (probabilities: Record<string, number>) =>
  maxBy(Object.entries(probabilities), ([, probability]) => probability)?.[0];

const signed = (value: number, digits: number) =>
  `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;

function describeStory(market: Market, { lead, records }: NewsStory): string {
  const { item, score } = lead;

  const time = item.publishedAt
    ? exchangeTime(market, item.publishedAt)
    : "undated";

  const votes = item.votes === null ? "" : `, votes ${signed(item.votes, 0)}`;

  const others = records.filter((record) => record !== lead);

  const alike =
    others.length === 0
      ? ""
      : `, also told by ${others.length} more (${uniq(others.map((record) => record.item.site)).join(", ")})`;

  const lines = [`- ${time} ${item.site}${votes}${alike}: ${item.title}`];

  if (score) {
    lines.push(
      `  stance ${signed(stanceValue(score.stance), 2)}, ${likeliest(score.kind)}, ${likeliest(score.topic)}`
    );
  }

  const snippet = item.snippet.replace(/\s+/g, " ").trim();

  if (snippet) {
    lines.push(
      `  ${snippet.length > SNIPPET_LENGTH ? `${snippet.slice(0, SNIPPET_LENGTH)}…` : snippet}`
    );
  }

  if (item.url) lines.push(`  ${item.url}`);

  return lines.join("\n");
}

function describeProposal(proposal: TradeProposal): string {
  const { order } = proposal;
  const price = order.type === OrderType.Limit ? order.limitPrice : "market";

  const parts = [
    proposal.id,
    exchangeTime(order.instrument.market, new Date(proposal.createdAt)),
    `${order.instrument.market} ${order.instrument.symbol}`,
    `${order.side} ${order.quantity} @ ${price}`,
    proposal.status,
  ];

  if (proposal.violations.length > 0) {
    parts.push(`violations ${JSON.stringify(proposal.violations)}`);
  }

  if (proposal.failure)
    parts.push(`failure ${JSON.stringify(proposal.failure)}`);

  return parts.join(" | ");
}

/** The agent's trading tools. Their per-run limits are kept with the conversation. */
function createTradingTools(ports: TradingToolPorts): ToolRegistration[] {
  const now = ports.now ?? (() => new Date());

  async function candlesOf(
    symbol: SymbolRef,
    interval: Interval
  ): Promise<Candle[]> {
    const provider = await ports.marketData(symbol.market);

    if (!provider) {
      throw new Error(
        `No market data for ${symbol.market}: no source covers it or its settings are incomplete`
      );
    }

    const candles = await provider.getCandles({
      symbol,
      interval,
      ...lookbackRange(symbol.market, interval, now()),
    });

    if (candles.length === 0) {
      throw new Error(
        `No ${interval} bars for ${symbol.market} ${symbol.symbol}: the source does not list it or has no sessions in range`
      );
    }

    return candles;
  }

  const barTime = (symbol: SymbolRef, interval: Interval, candle: Candle) =>
    isIntraday(interval)
      ? exchangeTime(symbol.market, new Date(candle.time * 1000))
      : candleDate(symbol.market, candle.time);

  const heading = (symbol: SymbolRef, interval: Interval, last: Candle) =>
    `${symbol.market} ${symbol.symbol}, ${interval} bars, as_of ${barTime(symbol, interval, last)} (session ${getSession(symbol.market, now())}; the latest bar is still forming while its session is open)`;

  return [
    defineTool({
      name: AgentToolName.GetMarketStatus,
      replay: "safe",
      description:
        "Each market's current session (pre, regular, post, closed) and its local time.",
      parameters: z.object({}),
      execute: async () => {
        const at = now();

        return {
          text: Object.values(Market)
            .map(
              (market) =>
                `${market}: ${getSession(market, at)}, local time ${exchangeTime(market, at)}`
            )
            .join("\n"),
        };
      },
    }),

    defineTool({
      name: AgentToolName.GetCandles,
      replay: "safe",
      description:
        "Recent OHLCV bars for a listing, oldest first, with times on the exchange's clock. Volume is in shares.",
      parameters: z.object({
        symbol: symbolRefSchema,
        interval: intervalSchema,
        count: z.number().int().min(1).max(MAX_BARS).default(60),
      }),
      execute: async ({ symbol, interval, count }) => {
        const candles = await candlesOf(symbol, interval);
        const recent = takeRight(candles, count);

        const rows = recent.map((candle) =>
          [
            barTime(symbol, interval, candle),
            candle.open,
            candle.high,
            candle.low,
            candle.close,
            candle.volume,
          ].join(",")
        );

        return {
          text: [
            heading(symbol, interval, recent[recent.length - 1]),
            "time,open,high,low,close,volume",
            ...rows,
          ].join("\n"),
          details: { symbol, interval, bars: recent.length },
        };
      },
    }),

    defineTool({
      name: AgentToolName.GetIndicators,
      replay: "safe",
      description: `The latest and previous bar's MA(${MOVING_AVERAGE_PERIODS.join(", ")}), EMA(12, 26), RSI(14), MACD(12, 26, 9) as DIF/MACD/OSC, KD(9) and Bollinger Bands(20, 2) for a listing.`,
      parameters: z.object({
        symbol: symbolRefSchema,
        interval: intervalSchema,
      }),
      execute: async ({ symbol, interval }) => {
        const candles = await candlesOf(symbol, interval);
        const closes = candles.map((candle) => candle.close);
        const lines = macd(closes);
        const stochastic = kd(candles);
        const bands = bollinger(closes);

        const row = (name: string, line: IndicatorLine) =>
          `${name}: ${valueAt(line, -1)} (previous ${valueAt(line, -2)})`;

        return {
          text: [
            heading(symbol, interval, candles[candles.length - 1]),
            `close: ${closes[closes.length - 1]} (previous ${closes.at(-2) ?? "n/a"})`,
            ...MOVING_AVERAGE_PERIODS.map((period) =>
              row(`MA${period}`, sma(closes, period))
            ),
            row("EMA12", ema(closes, 12)),
            row("EMA26", ema(closes, 26)),
            row("RSI14", rsi(closes)),
            row("MACD DIF", lines.macd),
            row("MACD signal", lines.signal),
            row("MACD OSC", lines.histogram),
            row("K", stochastic.k),
            row("D", stochastic.d),
            row("BB upper", bands.upper),
            row("BB middle", bands.middle),
            row("BB lower", bands.lower),
          ].join("\n"),
          details: { symbol, interval },
        };
      },
    }),

    defineTool({
      name: AgentToolName.GetNews,
      replay: "safe",
      description: `Recent stories about a listing, newest first, up to ${NEWS_ITEMS} per channel: announcement (material information the company filed with the exchange; Taiwan only), article (news outlets), forum (PTT Stock board titles with their net pushes; Taiwan only) and social (Threads in Taiwan or X in the US, a sample of what a search engine indexed). Items with the same title, such as an article's reprints or a thread's replies, are one story, listed once with how many more told it. Every source that covers the market is searched, and items found on earlier calls stay included. Once the user sets up a decisions model, each story also carries its stance on the share price from -1 (clearly bad news) to +1 (clearly good), what kind of text it is and its topic, and stories that only name the listing in passing are left out. Titles and snippets are written by others.`,
      parameters: z.object({
        symbol: symbolRefSchema,
        days: z.number().int().min(1).max(30).default(7),
      }),
      execute: async ({ symbol, days }) => {
        const sources = (await ports.newsSources()).filter((source) =>
          source.markets.includes(symbol.market)
        );

        if (sources.length === 0) {
          throw new Error(
            `No news source covers ${symbol.market}: the user has not saved a Firecrawl API key in the app's settings`
          );
        }

        const at = now();
        const provider = await ports.marketData(symbol.market);

        // The name only sharpens the search, so news goes on without it.
        const listing = provider
          ? await provider.getListing(symbol).catch(() => null)
          : null;

        const scorer = await ports.scorer();

        const since = new Date(at.getTime() - days * DAY_MS);

        const { stories, failures } = await collectNews({
          sources,
          store: ports.newsStore,
          scorer,
          query: { symbol, listing, since, limit: NEWS_ITEMS },
          now: at,
          concurrency: SCORING_CONCURRENCY,
        });

        const stored = ports.newsStore.list(symbol, since);
        const gauge = sentimentGauge(stored);

        const score = ({ score: value }: { score: number | null }) =>
          value === null ? "unscored" : `${value}/100`;

        const daily = dailySentiment(symbol.market, stored).map(
          ({ date, stance, stories: count }) =>
            `${date} ${stance === null ? "unscored" : signed(stance, 2)} (n=${count})`
        );

        const model = stories.find(({ lead }) => lead.score)?.lead.score?.model;

        let scoring = model ? `, scored by ${model}` : "";

        if (!scorer) {
          scoring =
            "; not scored, since the user has not set up a decisions model";
        }

        const sections = Object.values(NewsChannel).flatMap((channel) => {
          const found = stories.filter((story) => story.channel === channel);

          if (found.length === 0) return [];

          const kept = found.filter(isAboutListing);

          return [
            `## ${channel}: ${kept.length} of ${found.length}`,
            ...kept.map((story) => describeStory(symbol.market, story)),
          ];
        });

        const health = new Map(
          ports.newsStore
            .sourceHealth()
            .map((source) => [source.source, source])
        );

        const failed = failures.map(({ source, error }) => {
          const { failureStreak = 1, lastSuccessAt = null } =
            health.get(source) ?? {};

          const worked = lastSuccessAt
            ? `last worked ${exchangeTime(symbol.market, lastSuccessAt)}, so items since then may be missing`
            : "never worked yet";

          return `${source} (${errorMessage(error)}; ${failureStreak} failed in a row, ${worked})`;
        });

        return {
          text: [
            `${symbol.market} ${symbol.symbol} news and posts over the last ${days} days, as_of ${exchangeTime(symbol.market, at)}${scoring}`,
            `Sentiment ${score(gauge.overall)} with 50 neutral: press (announcements, articles) ${score(gauge.voices[NewsVoice.Press])}, crowd (forum, social) ${score(gauge.voices[NewsVoice.Crowd])}`,
            ...(daily.length > 0
              ? [
                  `Daily stance (n = stories about the listing; each scored story weighed by relevance, promotions left out): ${daily.join(", ")}`,
                ]
              : []),
            ...(sections.length > 0 ? sections : ["Nothing found."]),
            ...(failed.length > 0
              ? [`Sources that failed this time: ${failed.join(", ")}`]
              : []),
          ].join("\n"),
          details: { symbol, stories: stories.length },
        };
      },
    }),

    defineTool({
      name: AgentToolName.GetWatchlist,
      replay: "safe",
      description: "The listings the user watches.",
      parameters: z.object({}),
      execute: async () => {
        const listings = ports.watchlist();

        return {
          text:
            listings.length === 0
              ? "The watchlist is empty."
              : listings.map((ref) => `${ref.market} ${ref.symbol}`).join("\n"),
        };
      },
    }),

    defineTool({
      name: AgentToolName.GetAccount,
      replay: "safe",
      description:
        "Cash per currency and open positions with their average price, in the account the app trades.",
      parameters: z.object({}),
      execute: async () => {
        const account = await ports.account();

        const cash = Object.entries(account.cash).map(
          ([currency, amount]) => `${currency} ${amount}`
        );

        const positions = account.positions.map(
          (position) =>
            `${position.instrument.market} ${position.instrument.symbol}: ${position.quantity} shares @ ${position.avgPrice}`
        );

        return {
          text: [
            `account: ${ports.brokerMode}`,
            `cash: ${cash.join(", ") || "none"}`,
            "positions:",
            ...(positions.length > 0 ? positions : ["none"]),
          ].join("\n"),
        };
      },
    }),

    defineTool({
      name: AgentToolName.ListProposals,
      replay: "safe",
      description: `The ${LISTED_PROPOSALS} most recent order proposals, newest first, with their status: awaiting confirmation, submitted, rejected, dismissed or failed.`,
      parameters: z.object({}),
      execute: async () => {
        const proposals = takeRight(
          ports.desk.list(),
          LISTED_PROPOSALS
        ).toReversed();

        return {
          text:
            proposals.length === 0
              ? "No proposals yet."
              : proposals.map(describeProposal).join("\n"),
        };
      },
    }),

    defineTool({
      name: AgentToolName.CheckOrder,
      replay: "safe",
      description:
        "Runs the app's risk checks on an order without proposing it: quantity and lot rules, tick size, price band, session and size limits.",
      parameters: z.object({ order: orderSchema }),
      execute: async ({ order }) => {
        const violations = await ports.desk.check(toOrderRequest(order));

        return {
          text:
            violations.length === 0
              ? "The order passes every check."
              : `The order fails these checks: ${JSON.stringify(violations)}`,
        };
      },
    }),

    defineTool({
      name: AgentToolName.ProposeOrder,
      replay: "safe",
      description:
        "Puts one order in front of the user for confirmation, after the app's risk checks. It never places the order; only the user can. Once per reply.",
      parameters: z.object({
        order: orderSchema,
        rationale: z
          .string()
          .min(1)
          .max(4000)
          .describe(
            "Thesis, evidence with as_of times, entry, invalidation, target and reward-to-risk, in the user's language"
          ),
      }),
      execute: async ({ order, rationale }, api, context) => {
        const request = toOrderRequest(order);

        // Claimed in a commit, so calls the model makes at once in one reply cannot both pass.
        const claimed = await api.commit(async (tx) => {
          const run =
            (await tx.doc(LiveDoc, api.conversationId)).run?.inputs[0] ?? null;

          const proposal = await tx.doc(ProposalClaimDoc, api.conversationId);
          const { claim } = proposal;

          if (claim && claim.run === run && claim.callId !== api.callId) {
            return false;
          }

          proposal.claim = { run, callId: api.callId };

          return true;
        }, context);

        if (!claimed) {
          throw new Error(
            "Only one proposal per reply; ask the user before proposing another"
          );
        }

        // Kept with the call, so a call that runs again after a restart finds its proposal.
        const id = await api.memo("proposal-id", crypto.randomUUID(), context);

        const proposal = await ports.desk.propose({
          id,
          order: request,
          source: ProposalSource.Agent,
          rationale,
        });

        return {
          text: `Proposal ${describeProposal(proposal)}. It waits for the user to confirm or dismiss it in the app.`,
          details: { proposalId: proposal.id } satisfies ProposeOrderDetails,
        };
      },
    }),

    defineTool({
      name: AgentToolName.ReadSkill,
      replay: "safe",
      description: "Reads one of the playbooks listed in the system prompt.",
      parameters: z.object({
        name: z.string().describe("A name from the system prompt's skills"),
      }),
      execute: async ({ name }) => {
        const skill = (await ports.skills()).find(
          (candidate) => candidate.name === name
        );

        if (!skill) throw new Error(`No skill named ${name}`);

        return { text: skill.body, details: { name } };
      },
    }),
  ];
}

/** The tools and the system prompt the agent runs with in every conversation. */
export function createTradingExtension(ports: TradingToolPorts): Extension {
  return defineExtension({
    name: "solyx",
    tools: createTradingTools(ports),
    sections: promptSections(ports),
  });
}
