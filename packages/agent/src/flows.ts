import { defineExtension } from "@earendil-works/pi-durable";
import type { Extension } from "@earendil-works/pi-durable";
import * as z from "zod";

import {
  Investor,
  MONTH_SESSIONS,
  WEEK_SESSIONS,
  balanceTrend,
  netBuying,
} from "@solyx/core/flows";
import type {
  BalanceTrend,
  Flows,
  InvestorTrades,
  ListingFlows,
  MarketFlows,
} from "@solyx/core/flows";
import {
  Market,
  currencyOf,
  exchangeTime,
  symbolRefSchema,
} from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { TW_BOARD_LOT } from "@solyx/core/rules/tw";

import { defineTool } from "./tools.ts";
import { AgentToolName } from "./wire.ts";

export interface FlowToolsOptions {
  flows: Flows;
  now?: () => Date;
}

const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;

const share = (part: number, whole: number) =>
  whole === 0 ? "n/a" : `${((part / whole) * 100).toFixed(1)}%`;

const lots = (shares: number) => Math.round(shares / TW_BOARD_LOT);

const millions = (amount: number) => Math.round(amount / 1e6);

const named = (investor: Investor) => investor.replaceAll("-", " ");

/** How far a balance moved over a session, a week and a month of sessions, in the unit `scale` gives. */
function changes(trend: BalanceTrend, scale: (value: number) => number) {
  const moved = (value: number | null) =>
    value === null ? "n/a" : signed(scale(value));

  return `change ${moved(trend.session)} over a session, ${moved(trend.week)} over a week, ${moved(trend.month)} over a month`;
}

/** Each group's net buying as a table, in the unit `scale` gives. */
function netBuyingText(
  trades: readonly InvestorTrades[],
  scale: (value: number) => number
): string[] {
  const through = trades.at(-1)?.date;

  if (through === undefined) return ["Net buying: none reported."];

  return [
    `Net buying through ${through}, bought less sold, over the newest session, a week and a month, and the run of sessions on the newest one's side:`,
    "investor,session,week,month,run",
    ...netBuying(trades).map(({ investor, session, week, month, streak }) =>
      [
        named(investor),
        signed(scale(session)),
        signed(scale(week)),
        signed(scale(month)),
        streak > 0
          ? `bought ${streak}`
          : streak < 0
            ? `sold ${-streak}`
            : "flat",
      ].join(",")
    ),
  ];
}

function listingText(symbol: SymbolRef, flows: ListingFlows): string[] {
  const margin = balanceTrend(
    flows.margin.map(({ date, margin }) => ({ date, value: margin }))
  );

  const short = balanceTrend(
    flows.margin.map(({ date, short }) => ({ date, value: short }))
  );

  const newestMargin = flows.margin.at(-1);

  const foreign = balanceTrend(
    flows.foreign.map(({ date, ratio }) => ({ date, value: ratio * 100 }))
  );

  const limit = flows.foreign.at(-1)?.limit;

  return [
    `${symbol.market} ${symbol.symbol} in lots of ${TW_BOARD_LOT} shares:`,
    ...netBuyingText(flows.trades, lots),
    ...(margin && short && newestMargin
      ? [
          `Margin purchases on ${margin.date}: ${lots(margin.value)} lots, ${share(newestMargin.margin, newestMargin.marginLimit)} of the limit; ${changes(margin, lots)}`,
          `Short sales on ${short.date}: ${lots(short.value)} lots, ${share(newestMargin.short, newestMargin.margin)} of margin purchases; ${changes(short, lots)}`,
        ]
      : ["Margin: none reported."]),
    ...(foreign && limit !== undefined
      ? [
          `Foreign holding on ${foreign.date}: ${foreign.value.toFixed(2)}% of the shares issued, limit ${(limit * 100).toFixed(2)}%; in percentage points, ${changes(foreign, (points) => Number(points.toFixed(2)))}`,
        ]
      : ["Foreign holding: none reported."]),
  ];
}

function marketText(market: Market, flows: MarketFlows): string[] {
  const currency = currencyOf(market);

  const lending = balanceTrend(
    flows.margin.map(({ date, marginValue }) => ({ date, value: marginValue }))
  );

  const newestMargin = flows.margin.at(-1);

  const positions = Object.values(Investor).flatMap((investor) => {
    const trend = balanceTrend(
      flows.futures
        .filter((position) => position.investor === investor)
        .map(({ date, long, short }) => ({ date, value: long - short }))
    );

    return trend ? [{ investor, trend }] : [];
  });

  return [
    `${market} market, trades in ${currency} millions:`,
    ...netBuyingText(flows.trades, millions),
    ...(lending && newestMargin
      ? [
          `Margin lending on ${lending.date}: ${currency} ${millions(lending.value)} million; ${changes(lending, millions)}`,
          `Short sales on ${newestMargin.date}: ${lots(newestMargin.short)} lots, ${share(newestMargin.short, newestMargin.margin)} of the ${lots(newestMargin.margin)} lots bought on margin`,
        ]
      : ["Margin: none reported."]),
    ...(positions.length > 0
      ? [
          `TAIEX futures, net open interest in contracts (long less short) through ${positions[0].trend.date}:`,
          "investor,net,session,week,month",
          ...positions.map(({ investor, trend }) =>
            [
              named(investor),
              signed(trend.value),
              ...[trend.session, trend.week, trend.month].map((value) =>
                value === null ? "n/a" : signed(value)
              ),
            ].join(",")
          ),
        ]
      : ["Index futures positions: none reported."]),
  ];
}

/**
 * `get_flows`: who trades a listing and its market, as the host's flows serve them and the app
 * computes them, so the model cites the figures rather than works them out. It changes nothing.
 */
export function createFlowTools(options: FlowToolsOptions): Extension {
  const { flows } = options;
  const now = options.now ?? (() => new Date());

  return defineExtension({
    name: "solyx-flows",
    tools: [
      defineTool({
        name: AgentToolName.GetFlows,
        replay: "safe",
        description: `Who trades a listing and its market, computed by the app from what Taiwan's exchanges report after each session: each investor group's net buying (foreign investors, investment trusts, dealers on their own account, and dealers hedging the warrants they issued, which follows warrant holders rather than a view) over the newest session, a week (${WEEK_SESSIONS} sessions) and a month (${MONTH_SESSIONS}), with its run of sessions on one side; the listing's margin and short balances and foreign investors' holding; and the market's net buying, margin lending, short sales and each group's net position in TAIEX futures. A session's figures come out between 15:00 and 21:00 Taipei, so until then the newest is the session before. Taiwan only. Cite these rather than work them out again.`,
        parameters: z.object({
          symbol: symbolRefSchema
            .optional()
            .describe("A listing; the market's flows alone when left out"),
        }),
        async execute({ symbol }) {
          const market = symbol?.market ?? Market.TW;
          const details = { market, symbol: symbol ?? null };

          if (market !== Market.TW) {
            return {
              text: `No flows for ${market}: only Taiwan's exchanges report who trades each session.`,
              details,
            };
          }

          const [listing, whole] = await Promise.all([
            symbol ? flows.listing(symbol) : undefined,
            flows.market(market),
          ]);

          return {
            text: [
              `Flows as_of ${exchangeTime(market, now())} Taipei; a week is ${WEEK_SESSIONS} sessions and a month ${MONTH_SESSIONS}`,
              ...(symbol && listing ? listingText(symbol, listing) : []),
              ...marketText(market, whole),
            ].join("\n"),
            details,
          };
        },
      }),
    ],
  });
}
