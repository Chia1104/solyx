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
import { maxBy, omit, takeRight, uniq, uniqBy } from "es-toolkit";
import * as z from "zod";

import { EventTiming, ListingEventKind } from "@solyx/core/calendar";
import type {
  ListingEvent,
  ResearchEvent,
  UpcomingEvents,
} from "@solyx/core/calendar";
import {
  Interval,
  alignedCloses,
  candleDate,
  intervalSchema,
  isIntraday,
} from "@solyx/core/candles";
import type { Candle, IntradayInterval } from "@solyx/core/candles";
import { CouncilOutcome, councilOutcome } from "@solyx/core/council";
import type { Council } from "@solyx/core/council";
import {
  MOVING_AVERAGE_PERIODS,
  RELATIVE_STRENGTH_PERIODS,
  bollinger,
  ema,
  kd,
  macd,
  relativeReturn,
  rsi,
  sma,
  volumeRatio,
  vwap,
} from "@solyx/core/indicators";
import type { IndicatorLine } from "@solyx/core/indicators";
import {
  PROFILE_SESSIONS,
  ZoneKind,
  openingRange,
  pointOfControl,
  previousSession,
  supportZones,
  volumeProfile,
  yearRange,
} from "@solyx/core/levels";
import type { PriceRange } from "@solyx/core/levels";
import type { MacroRelease } from "@solyx/core/macro";
import {
  BENCHMARK,
  Market,
  exchangeDate,
  exchangeMidnight,
  exchangeTime,
  instrumentKindSchema,
  marketSchema,
  shiftDate,
  symbolKey,
  symbolRefSchema,
} from "@solyx/core/market";
import type { Benchmark, SymbolRef } from "@solyx/core/market";
import type { MarketData } from "@solyx/core/market-data";
import {
  NewsChannel,
  NewsVoice,
  TimePrecision,
  isAboutListing,
} from "@solyx/core/news";
import type { NewsDesk, NewsStory, Published } from "@solyx/core/news";
import { OrderType, sideSchema } from "@solyx/core/order";
import type { OrderRequest } from "@solyx/core/order";
import { ProposalSource } from "@solyx/core/order-desk";
import type { ProposingDesk, TradeProposal } from "@solyx/core/order-desk";
import { stanceValue } from "@solyx/core/sentiment";
import { getSession, sessionsBetween, weekdays } from "@solyx/core/session";
import type { TradingDays } from "@solyx/core/session";
import { errorMessage } from "@solyx/utils/error";

import { rememberAddresses } from "./found-addresses.ts";
import { councilText, durableBallotBox, orderMotion } from "./magi.ts";
import type { MagiPort } from "./magi.ts";
import { promptSections } from "./prompt.ts";
import type { PromptSources } from "./prompt.ts";
import { AgentToolName } from "./wire.ts";
import type { ProposeOrderDetails } from "./wire.ts";

/** What the tools and the prompt read, and the one thing the tools may do: propose. */
export interface TradingToolPorts extends PromptSources {
  marketData: MarketData;
  watchlist(): SymbolRef[];
  news: Pick<NewsDesk, "collect">;
  /** The days a market trades, as far as the host knows them. */
  tradingDays(market: Market): Promise<TradingDays>;
  /** The listings' coming events and their markets' releases over the next `days` days, as the app's overview lists them. */
  calendar(
    symbols: readonly SymbolRef[],
    days: number
  ): Promise<UpcomingEvents>;
  desk: ProposingDesk;
  /** Puts each order proposal to a vote while the user has decisions go to the MAGI. */
  magi?: MagiPort;
  now?: () => Date;
}

export interface ToolOutput {
  /** What the model reads. */
  text: string;
  /** What the renderer shows. */
  details?: JsonValue;
}

export interface ToolSpec<Parameters extends z.ZodObject> {
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
export function defineTool<Parameters extends z.ZodObject>(
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
export const SNIPPET_LENGTH = 280;

const DAY_MS = 24 * 60 * 60 * 1000;

const MOVING_AVERAGES = [
  ...MOVING_AVERAGE_PERIODS.short,
  ...MOVING_AVERAGE_PERIODS.long,
];

const ZONE_NAMES: Record<ZoneKind, string> = {
  [ZoneKind.QuarterLine]: "MA60",
  [ZoneKind.HalfYearLine]: "MA120",
  [ZoneKind.Volume]: "dense trading",
};

const priceRange = ({ low, high }: PriceRange) =>
  `${Number(low.toFixed(2))}-${Number(high.toFixed(2))}`;

/** The levels an intraday chart marks, as `get_indicators` reports them. */
function sessionLevels(
  market: Market,
  interval: IntradayInterval,
  bars: Candle[]
): string[] {
  const line = vwap(market, bars);
  const previous = previousSession(market, bars);
  const opening = openingRange(market, interval, bars);

  return [
    `VWAP: ${valueAt(line, -1)} (previous ${valueAt(line, -2)})`,
    `previous session: ${
      previous
        ? `high ${previous.high}, low ${previous.low}, close ${previous.close}`
        : "n/a"
    }`,
    `opening range: ${opening ? priceRange(opening) : "n/a"}`,
  ];
}

/** The levels a daily chart marks and its strength against the market's index, as `get_indicators` reports them. */
function dailyLevels(
  daily: Candle[],
  benchmark: Benchmark,
  benchmarkBars: Candle[]
): string[] {
  const year = yearRange(daily);
  const zones = supportZones(daily);
  const control = pointOfControl(volumeProfile(daily));
  const closes = daily.map((candle) => candle.close);
  const aligned = alignedCloses(daily, benchmarkBars);

  const strength = RELATIVE_STRENGTH_PERIODS.map((period) => {
    const value = relativeReturn(closes, aligned, period).at(-1);

    return `${period} sessions ${
      value === null || value === undefined ? "n/a" : signed(value, 2)
    }`;
  });

  return [
    `52-week range: ${year ? priceRange(year) : "n/a"}`,
    `support zones: ${
      zones.length === 0
        ? "none"
        : zones
            .map((zone) => `${ZONE_NAMES[zone.kind]} ${priceRange(zone)}`)
            .join("; ")
    }`,
    `volume point of control: ${control ? priceRange(control) : "n/a"}`,
    `relative strength vs ${benchmark.name}, percentage points: ${strength.join(", ")}`,
  ];
}

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

/** Shows a time no more exactly than its source tells it. */
const PRECISE_TO: Record<TimePrecision, (time: string) => string> = {
  [TimePrecision.Minute]: (time) => time,
  [TimePrecision.Hour]: (time) => `~${time}`,
  [TimePrecision.Day]: (time) => time.slice(0, "YYYY-MM-DD".length),
};

/** On the market's clock, or in UTC without one. */
export const publishedTime = (
  market: Market | null,
  published: Published | null
) => {
  if (!published) return "undated";

  const time = market
    ? exchangeTime(market, published.at)
    : `${published.at.toISOString().slice(0, 16).replace("T", " ")} UTC`;

  return PRECISE_TO[published.precision](time);
};

/**
 * How many regular sessions have traded since an item came out, the one under way included; for an
 * item dated only by its day, after that day.
 */
function sessionsSince(
  market: Market,
  { at, precision }: Published,
  now: Date,
  trades: TradingDays
): string {
  const byDay = precision === TimePrecision.Day;

  const from = byDay
    ? new Date(
        exchangeMidnight(market, shiftDate(exchangeDate(market, at), 1)) * 1000
      )
    : at;

  const sessions = sessionsBetween(market, from, now, trades);
  const since = byDay ? "after that day" : "since";

  if (sessions === 0) return `no session ${since}`;

  return `${sessions} session${sessions === 1 ? "" : "s"} ${since}`;
}

/** An event's day, which a deadline shows as the latest it may come and an expected one as about then. */
export function eventDay(date: string, timing: EventTiming): string {
  switch (timing) {
    case EventTiming.Set:
      return date;
    case EventTiming.Deadline:
      return `by ${date}`;
    case EventTiming.Expected:
      return `around ${date}`;
  }
}

const perShare = (amount: number | null) => String(amount ?? 0);

function describeEvent(event: ListingEvent): string {
  const where = `${eventDay(event.date, event.timing)} ${event.symbol.market} ${event.symbol.symbol}`;

  switch (event.kind) {
    case ListingEventKind.QuarterlyReport: {
      const end = Temporal.PlainDate.from(event.subject);

      return `${where} Q${Math.ceil(end.month / 3)} ${end.year} statements due`;
    }

    case ListingEventKind.MonthlyRevenue:
      return `${where} ${event.subject} revenue due`;
    case ListingEventKind.ExDividend:
      return `${where} goes ex-dividend, ${perShare(event.amount)} cash a share (${event.subject})`;
    case ListingEventKind.ExRights:
      return `${where} goes ex-rights, ${perShare(event.amount)} in stock a share (${event.subject})`;
    case ListingEventKind.DividendPayment:
      return `${where} pays its dividend, ${perShare(event.amount)} cash a share (${event.subject})`;
    default: {
      const span = event.until === null ? "" : ` until ${event.until}`;
      const note = event.subject ? ` (${event.subject})` : "";

      return `${where} ${event.kind.replaceAll("-", " ")}${span}${note}`;
    }
  }
}

const describeResearchEvent = (event: ResearchEvent) =>
  `${eventDay(event.date, event.timing)} ${event.symbol.market} ${event.symbol.symbol} ${event.label} [${event.source}]`;

function describeRelease(release: MacroRelease): string {
  const period = release.period === null ? "" : ` for ${release.period}`;

  return `${eventDay(release.date, release.timing)} ${release.market} ${release.indicator.replaceAll("-", " ")}${period}`;
}

/** A market's trading days, or every weekday and the reason they could not be read. */
async function readTradingDays(ports: TradingToolPorts, market: Market) {
  try {
    return { trades: await ports.tradingDays(market), failure: null };
  } catch (error) {
    return { trades: weekdays, failure: errorMessage(error) };
  }
}

function describeStory(
  market: Market,
  { lead, records }: NewsStory,
  now: Date,
  trades: TradingDays
): string {
  const { item, score } = lead;

  const time = item.published
    ? `${publishedTime(market, item.published)} (${sessionsSince(market, item.published, now, trades)})`
    : publishedTime(market, item.published);

  const votes = item.votes === null ? "" : `, votes ${signed(item.votes, 0)}`;

  const others = records.filter((record) => record !== lead);

  const alike =
    others.length === 0
      ? ""
      : `, also told by ${others.length} more (${uniq(others.map((record) => record.item.site)).join(", ")})`;

  const lines = [`- ${time} ${item.site}${votes}${alike}: ${item.title}`];

  if (score) {
    lines.push(
      `  stance ${signed(stanceValue(score.stance), 2)}, ${likeliest(score.kind)}, ${likeliest(score.topic)}, speaker ${likeliest(score.speaker)}`
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

export function describeProposal(proposal: TradeProposal): string {
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
    const candles = await ports.marketData.candles(symbol, interval);

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
      description: `The latest and previous bar's MA(${MOVING_AVERAGES.join(", ")}), EMA(12, 26), RSI(14), MACD(12, 26, 9) as DIF/MACD/OSC, KD(9), Bollinger Bands(20, 2) and volume over its 20-bar average for a listing. On daily bars also the levels its chart marks: the 52-week range, the support zones (within 2% of MA60 and 3% of MA120 while the close is above each, and the densest trading under the close) and the volume profile's point of control over the last ${PROFILE_SESSIONS} sessions; and relative strength against the market's index (${BENCHMARK[Market.TW].name} in Taiwan, ${BENCHMARK[Market.US].name} in the US), the percentage points by which the listing's return beat the index's over the last ${RELATIVE_STRENGTH_PERIODS.join(", ")} sessions. On intraday bars also the newest session's VWAP, the high, low and close of the session before it, and its opening range, the high and low of its first 30 minutes of regular trading, on bars of 30 minutes or less once those minutes have passed.`,
      parameters: z.object({
        symbol: symbolRefSchema,
        interval: intervalSchema,
      }),
      execute: async ({ symbol, interval }) => {
        const daily = interval === Interval.OneDay;
        const benchmark = BENCHMARK[symbol.market];

        const [candles, benchmarkBars] = await Promise.all([
          candlesOf(symbol, interval),
          daily ? candlesOf(benchmark.symbol, interval) : [],
        ]);

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
            ...MOVING_AVERAGES.map((period) =>
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
            row(
              "Volume/MA20",
              volumeRatio(candles.map((candle) => candle.volume))
            ),
            ...(daily ? dailyLevels(candles, benchmark, benchmarkBars) : []),
            ...(isIntraday(interval)
              ? sessionLevels(symbol.market, interval, candles)
              : []),
          ].join("\n"),
          details: { symbol, interval },
        };
      },
    }),

    defineTool({
      name: AgentToolName.GetNews,
      replay: "safe",
      description: `Recent stories about a listing, newest first, up to ${NEWS_ITEMS} per channel: announcement (material information the company filed with the exchange; Taiwan only), article (news outlets), forum (PTT Stock board titles with their net pushes; Taiwan only) and social (Threads in Taiwan or X in the US, a sample of what a search engine indexed). Items that tell one story are listed once with how many more told it: an article's reprints and a thread's replies, and, once the exchange's names for the listing are known, outlets or posts that reword one headline within a day. Times are the exchange's local time: ~ marks a search engine's estimate, within about an hour, and a date alone means only the day is known. Each dated story also says how many regular sessions have traded since it came out, the one under way included, or for a date alone after that day, so a story out after the close, over a weekend or on a holiday shows none yet; Taiwan's holidays are those its exchange set, while in the US every weekday counts as a session, since its holidays are not known. Every source that covers the market is searched, and items found on earlier calls stay included. Once the user sets up a decisions model, each story also carries its stance on the share price from -1 (clearly bad news) to +1 (clearly good), what kind of text it is, its topic and who speaks in it (the company, an outlet, an investor, a page of data or someone else, whatever channel it came through), and stories that only name the listing in passing or are pages of data are left out. Titles and snippets are written by others.`,
      parameters: z.object({
        symbol: symbolRefSchema,
        days: z.number().int().min(1).max(30).default(7),
      }),
      execute: async ({ symbol, days }, api, context) => {
        const at = now();
        const since = new Date(at.getTime() - days * DAY_MS);

        const [{ stories, gauge, daily, failures, scored }, calendar] =
          await Promise.all([
            ports.news.collect(symbol, since, NEWS_ITEMS),
            readTradingDays(ports, symbol.market),
          ]);

        const score = ({ score: value }: { score: number | null }) =>
          value === null ? "unscored" : `${value}/100`;

        const stances = daily.map(
          ({ date, stance, stories: count }) =>
            `${date} ${stance === null ? "unscored" : signed(stance, 2)} (n=${count})`
        );

        const model = stories.find(({ lead }) => lead.score)?.lead.score?.model;

        let scoring = model ? `, scored by ${model}` : "";

        if (!scored) {
          scoring =
            "; not scored, since the user has not set up a decisions model";
        }

        const sections = Object.values(NewsChannel).flatMap((channel) => {
          const found = stories.filter((story) => story.channel === channel);

          if (found.length === 0) return [];

          const kept = found.filter(isAboutListing);

          return [
            `## ${channel}: ${kept.length} of ${found.length}`,
            ...kept.map((story) =>
              describeStory(symbol.market, story, at, calendar.trades)
            ),
          ];
        });

        await rememberAddresses(
          api,
          stories
            .filter(isAboutListing)
            .flatMap(({ lead }) => (lead.item.url ? [lead.item.url] : [])),
          context
        );

        const failed = failures.map(
          ({ source, lastError, failureStreak, lastSuccessAt }) => {
            const worked = lastSuccessAt
              ? `last worked ${exchangeTime(symbol.market, lastSuccessAt)}, so items since then may be missing`
              : "never worked yet";

            return `${source} (${lastError}; ${failureStreak} failed in a row, ${worked})`;
          }
        );

        return {
          text: [
            `${symbol.market} ${symbol.symbol} news and posts over the last ${days} days, as_of ${exchangeTime(symbol.market, at)}${scoring}`,
            `Sentiment ${score(gauge.overall)} with 50 neutral: press (announcements, articles) ${score(gauge.voices[NewsVoice.Press])}, crowd (forum, social) ${score(gauge.voices[NewsVoice.Crowd])}`,
            ...(stances.length > 0
              ? [
                  `Daily stance (n = stories about the listing; each scored story weighed by relevance, promotions left out): ${stances.join(", ")}`,
                ]
              : []),
            ...(sections.length > 0 ? sections : ["Nothing found."]),
            ...(failed.length > 0
              ? [`Sources that failed this time: ${failed.join(", ")}`]
              : []),
            ...(calendar.failure === null
              ? []
              : [
                  `The exchange's trading days could not be read (${calendar.failure}), so every weekday counted as a session.`,
                ]),
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
      name: AgentToolName.GetCalendar,
      replay: "safe",
      description: `The dates ahead for listings, the same list the app's overview shows: each quarter's statements and month's revenue not out yet, by the latest day Taiwan's rules allow (a company may well report earlier; the app does not know the day it chose); the days distributions go ex and are paid, as the company set them; trading restrictions such as short-sale suspensions and dispositions; the dates the listings' reports hold, which are what you found and kept with revise_report, each with its source; and the economic releases of the listings' markets, each on its day or by the latest day its agency set. Dates are YYYY-MM-DD on each market's exchange calendar, "by" marks a latest day and "around" a day a source only expects. Filings and releases are Taiwan's only for now: a US listing has only its report's dates, no US releases are known, an earnings call is on it only once a report holds it, and holidays and market closures are not on it. Defaults to the listings the user holds and watches.`,
      parameters: z.object({
        symbols: z
          .array(symbolRefSchema)
          .optional()
          .describe("Defaults to the listings the user holds and watches"),
        days: z.number().int().min(1).max(90).default(30),
      }),
      execute: async ({ symbols, days }) => {
        const listings =
          symbols ??
          uniqBy(
            [
              ...(await ports.desk.account()).positions.map(
                ({ instrument: { market, symbol } }) => ({ market, symbol })
              ),
              ...ports.watchlist(),
            ],
            symbolKey
          );

        const { events, research, unread, releases, unreadMarkets } =
          await ports.calendar(listings, days);

        const named = listings
          .map(({ market, symbol }) => `${market} ${symbol}`)
          .join(", ");

        const missing = [
          ...(unread.length > 0
            ? [
                `the fundamentals of ${unread.map(({ market, symbol }) => `${market} ${symbol}`).join(", ")}`,
              ]
            : []),
          ...(unreadMarkets.length > 0
            ? [`the release schedule of ${unreadMarkets.join(", ")}`]
            : []),
        ];

        return {
          text: [
            `Calendar of ${listings.length === 0 ? "no listings" : named} over the next ${days} days, each market from its own day today, as_of ${exchangeTime(Market.TW, now())} Taipei; the same list the app's overview shows`,
            "Listings' filings, distributions and restrictions:",
            ...(events.length > 0 ? events.map(describeEvent) : ["None."]),
            "Dates their reports hold, each as you found it, with its source:",
            ...(research.length > 0
              ? research.map(describeResearchEvent)
              : ["None."]),
            "Economic releases of their markets:",
            ...(releases.length > 0
              ? releases.map(describeRelease)
              : ["None."]),
            ...(missing.length > 0
              ? [
                  `Could not read ${missing.join("; ")} this time, so dates may be missing.`,
                ]
              : []),
          ].join("\n"),
          details: {
            symbols: listings,
            days,
            events: events.length + research.length,
            releases: releases.length,
          },
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
        const account = await ports.desk.account();

        const cash = Object.entries(account.cash).map(
          ([currency, amount]) => `${currency} ${amount}`
        );

        const positions = account.positions.map(
          (position) =>
            `${position.instrument.market} ${position.instrument.symbol}: ${position.quantity} shares @ ${position.avgPrice}`
        );

        return {
          text: [
            `account: ${ports.desk.mode}`,
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
        const convene = await ports.magi?.(api.conversationId);
        const box = durableBallotBox(api, context);
        const made = ports.desk.list().some((each) => each.id === id);

        // An order the checks refuse is kept as rejected without a vote, and one already made
        // under this call shows the vote it kept rather than holding another.
        let council: Council | undefined;

        if (convene && made) {
          council = await box.council();
        } else if (convene && (await ports.desk.check(request)).length === 0) {
          council = await convene(
            orderMotion(
              request,
              rationale,
              await ports.desk.account(),
              ports.desk.mode
            ),
            box
          );
        }

        if (council && !council.carried) {
          return {
            text: `${councilText(council)}\nNo proposal was made, and this reply may put no other. ${
              councilOutcome(council) === CouncilOutcome.Undecided
                ? "Tell the user which units gave no vote and why; the same motion may be put again in a later reply if they ask."
                : "Tell the user how the units voted."
            }`,
            details: { council } satisfies ProposeOrderDetails,
          };
        }

        const proposal = await ports.desk.propose({
          id,
          order: request,
          source: ProposalSource.Agent,
          rationale,
        });

        return {
          text: [
            ...(council ? [councilText(council)] : []),
            `Proposal ${describeProposal(proposal)}. It waits for the user to confirm or dismiss it in the app.`,
          ].join("\n"),
          details: {
            proposalId: proposal.id,
            ...(council && { council }),
          } satisfies ProposeOrderDetails,
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

        return {
          text: skill.folder
            ? `${skill.body}\n\nThis skill's files are in ${skill.folder}; run its scripts with bash from there.`
            : skill.body,
          details: { name },
        };
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
