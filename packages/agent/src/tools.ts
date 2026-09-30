import type { AgentTool } from "@earendil-works/pi-agent-core";
import { omit, takeRight } from "es-toolkit";
import * as z from "zod";

import type { BrokerMode } from "@solyx/core/broker";
import { LOOKBACK_DAYS, intervalSchema, isIntraday } from "@solyx/core/candles";
import type { Candle, Interval } from "@solyx/core/candles";
import { bollinger, ema, kd, macd, rsi, sma } from "@solyx/core/indicators";
import type { IndicatorLine } from "@solyx/core/indicators";
import {
  Market,
  exchangeDate,
  instrumentKindSchema,
  marketSchema,
  shiftDate,
  symbolRefSchema,
} from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { MarketDataProvider } from "@solyx/core/market-data";
import { OrderType, sideSchema } from "@solyx/core/order";
import type { AccountSnapshot, OrderRequest } from "@solyx/core/order";
import { ProposalSource } from "@solyx/core/order-desk";
import type { OrderDesk, TradeProposal } from "@solyx/core/order-desk";
import { getSession } from "@solyx/core/session";

import { exchangeTime } from "./format.ts";
import type { AgentSkill } from "./skills.ts";
import { AgentToolName } from "./wire.ts";
import type { ProposeOrderDetails } from "./wire.ts";

/** What the tools read and the one thing they may do: propose. */
export interface TradingToolPorts {
  /** The market's provider, or `undefined` when no source covers it or its settings are incomplete. */
  marketData(market: Market): Promise<MarketDataProvider | undefined>;
  watchlist(): SymbolRef[];
  account(): Promise<AccountSnapshot>;
  brokerMode: BrokerMode;
  desk: Pick<OrderDesk, "check" | "propose" | "list">;
  /** The skills this run is offered, which `read_skill` reads. */
  skills: readonly AgentSkill[];
  now?: () => Date;
}

interface ToolOutput {
  /** What the model reads. */
  text: string;
  /** What the renderer shows; JSON only. */
  details?: unknown;
}

interface ToolSpec<Parameters extends z.ZodObject> {
  name: AgentToolName;
  label: string;
  description: string;
  parameters: Parameters;
  execute(params: z.infer<Parameters>): Promise<ToolOutput>;
}

/**
 * pi validates the model's arguments against the JSON Schema before `execute`; parsing them
 * again with zod types them and applies what JSON Schema cannot express.
 */
function defineTool<Parameters extends z.ZodObject>(
  spec: ToolSpec<Parameters>
): AgentTool {
  return {
    name: spec.name,
    label: spec.label,
    description: spec.description,
    // Providers read the schema inline; the dialect URI is noise to them.
    parameters: omit(z.toJSONSchema(spec.parameters, { io: "input" }), [
      "$schema",
    ]),
    async execute(_toolCallId, params) {
      const parsed = spec.parameters.safeParse(params);

      if (!parsed.success) throw new Error(z.prettifyError(parsed.error));

      const { text, details } = await spec.execute(parsed.data);

      return { content: [{ type: "text", text }], details };
    },
  };
}

const MAX_BARS = 200;

const round = (value: number) => Number(value.toPrecision(8));

const valueAt = (line: IndicatorLine, offset: number) => {
  const value = line.at(offset);

  return value === null || value === undefined ? "n/a" : round(value);
};

const orderSchema = z.object({
  market: marketSchema,
  symbol: z.string().min(1).describe("Exchange code, such as 2330 or AAPL"),
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
    symbol: order.symbol.trim().toUpperCase(),
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

function describeProposal(proposal: TradeProposal): string {
  const { order } = proposal;
  const price = order.type === OrderType.Limit ? order.limitPrice : "market";

  const parts = [
    proposal.id,
    exchangeTime(order.instrument.market, proposal.createdAt),
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

/** The agent's tools for one run; build them again for every run so per-run limits start over. */
export function createTradingTools(ports: TradingToolPorts): AgentTool[] {
  const now = ports.now ?? (() => new Date());
  let proposed = false;

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

    const to = exchangeDate(symbol.market, now());

    const candles = await provider.getCandles({
      symbol,
      interval,
      from: shiftDate(to, -LOOKBACK_DAYS[interval]),
      to,
    });

    if (candles.length === 0) {
      throw new Error(
        `No ${interval} bars for ${symbol.market} ${symbol.symbol}: the source does not list it or has no sessions in range`
      );
    }

    return candles;
  }

  const barTime = (symbol: SymbolRef, interval: Interval, candle: Candle) => {
    const time = exchangeTime(symbol.market, candle.time * 1000);

    return isIntraday(interval) ? time : time.slice(0, 10);
  };

  const heading = (symbol: SymbolRef, interval: Interval, last: Candle) =>
    `${symbol.market} ${symbol.symbol}, ${interval} bars, as_of ${barTime(symbol, interval, last)} (session ${getSession(symbol.market, now())}; the latest bar is still forming while its session is open)`;

  return [
    defineTool({
      name: AgentToolName.GetMarketStatus,
      label: "Market status",
      description:
        "Each market's current session (pre, regular, post, closed) and its local time.",
      parameters: z.object({}),
      execute: async () => {
        const at = now();

        return {
          text: Object.values(Market)
            .map(
              (market) =>
                `${market}: ${getSession(market, at)}, local time ${exchangeTime(market, at.getTime())}`
            )
            .join("\n"),
        };
      },
    }),

    defineTool({
      name: AgentToolName.GetCandles,
      label: "Candles",
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
      label: "Indicators",
      description:
        "The latest and previous bar's MA(5, 20, 60), EMA(12, 26), RSI(14), MACD(12, 26, 9) as DIF/MACD/OSC, KD(9) and Bollinger Bands(20, 2) for a listing.",
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
            row("MA5", sma(closes, 5)),
            row("MA20", sma(closes, 20)),
            row("MA60", sma(closes, 60)),
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
      name: AgentToolName.GetWatchlist,
      label: "Watchlist",
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
      label: "Account",
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
      label: "Proposals",
      description:
        "The 20 most recent order proposals, newest first, with their status: awaiting confirmation, submitted, rejected, dismissed or failed.",
      parameters: z.object({}),
      execute: async () => {
        const proposals = takeRight(ports.desk.list(), 20).toReversed();

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
      label: "Check order",
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
      label: "Propose order",
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
      execute: async ({ order, rationale }) => {
        if (proposed) {
          throw new Error(
            "Only one proposal per reply; ask the user before proposing another"
          );
        }

        proposed = true;

        const proposal = await ports.desk.propose({
          order: toOrderRequest(order),
          source: ProposalSource.Agent,
          rationale,
        });

        const details: ProposeOrderDetails = { proposalId: proposal.id };

        return {
          text: `Proposal ${describeProposal(proposal)}. It waits for the user to confirm or dismiss it in the app.`,
          details,
        };
      },
    }),

    defineTool({
      name: AgentToolName.ReadSkill,
      label: "Read skill",
      description: "Reads one of the playbooks listed in the system prompt.",
      parameters: z.object({
        name: z
          .string()
          .describe(ports.skills.map((skill) => skill.name).join(", ")),
      }),
      execute: async ({ name }) => {
        const skill = ports.skills.find((candidate) => candidate.name === name);

        if (!skill) throw new Error(`No skill named ${name}`);

        return { text: skill.body, details: { name } };
      },
    }),
  ];
}
