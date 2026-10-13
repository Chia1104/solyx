import { defineExtension } from "@earendil-works/pi-durable";
import type { Extension } from "@earendil-works/pi-durable";
import { groupBy, orderBy, sumBy, uniqBy } from "es-toolkit";
import * as z from "zod";

import {
  Market,
  currencyOf,
  exchangeTime,
  symbolKey,
  symbolRefSchema,
} from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { MarketData } from "@solyx/core/market-data";
import { positionValue } from "@solyx/core/order";
import type { Position, PositionValue } from "@solyx/core/order";
import type { ProposingDesk } from "@solyx/core/order-desk";
import { quoteChange } from "@solyx/core/quote";
import type { SessionQuote } from "@solyx/core/quote";
import { errorMessage } from "@solyx/utils/error";

import { defineTool } from "./tools.ts";
import { AgentToolName } from "./wire.ts";

export interface QuoteToolsOptions {
  /** A listing's newest session against the close before it, as the app's overview reads it; `null` when no source covers its market or has bars for it. */
  quote(symbol: SymbolRef): Promise<SessionQuote | null>;
  marketData: Pick<MarketData, "listing">;
  watchlist(): SymbolRef[];
  desk: Pick<ProposingDesk, "account">;
  /** @default () => new Date() */
  now?: () => Date;
}

const MAX_SYMBOLS = 50;

/** A price or a sum without the digits arithmetic leaves behind. */
const figure = (value: number) => String(Number(value.toFixed(4)));

const signed = (value: number) => `${value > 0 ? "+" : ""}${figure(value)}`;

const percent = (fraction: number | null) =>
  fraction === null
    ? "n/a"
    : `${fraction > 0 ? "+" : ""}${(fraction * 100).toFixed(2)}%`;

const code = ({ market, symbol }: SymbolRef) => `${market} ${symbol}`;

interface Quoted {
  symbol: SymbolRef;
  name: string;
  quote: SessionQuote;
  moved: ReturnType<typeof quoteChange>;
}

interface Held extends Quoted {
  position: Position;
  worth: PositionValue;
  /** What the session's move made of the position; `null` without a close before. */
  today: number | null;
}

const quoteCells = ({ symbol, name, quote, moved }: Quoted) => [
  code(symbol),
  name,
  quote.date,
  figure(quote.last),
  moved ? signed(moved.change) : "n/a",
  percent(moved?.percent ?? null),
];

/** What the positions quoted in one currency add up to. */
function totalText(currency: string, held: readonly Held[]): string {
  const value = sumBy(held, ({ worth }) => worth.value);
  const cost = sumBy(held, ({ worth }) => worth.cost);

  return `Held in ${currency}: worth ${figure(value)} against a cost of ${figure(cost)}, gain ${signed(value - cost)} (${percent(cost === 0 ? null : (value - cost) / cost)}), today ${signed(sumBy(held, ({ today }) => today ?? 0))}`;
}

/**
 * `get_quotes`: many listings' newest sessions at once, and the user's positions marked at them,
 * through the quotes the host's overview reads, so the model cites what the app computed. It
 * changes nothing.
 */
export function createQuoteTools(options: QuoteToolsOptions): Extension {
  const now = options.now ?? (() => new Date());

  /** The positions to mark; a live broker answers over the network, and its failing leaves the quotes. */
  async function positions(): Promise<{
    positions: Position[];
    failure: string | null;
  }> {
    try {
      return {
        positions: (await options.desk.account()).positions,
        failure: null,
      };
    } catch (error) {
      return { positions: [], failure: errorMessage(error) };
    }
  }

  return defineExtension({
    name: "solyx-quotes",
    tools: [
      defineTool({
        name: AgentToolName.GetQuotes,
        replay: "safe",
        description: `Today at a glance for many listings at once, as the app's overview shows its moves: each listing's newest session against the close before it (its date, last price, change and percent), largest rise first, for everything the user holds and watches unless symbols names others. A held listing also comes with its position marked at the last price, computed by the app: shares, average price, what it is worth, its open gain against what it cost and what the session's move made of it, with each currency's totals. A session still open has not closed at its last price, and outside one the newest session is the last that traded. Each listing costs the market data source a request, so name symbols rather than quote a long watchlist for a few of them. For bars, levels and indicators read get_candles and get_indicators. Cite these rather than work them out again.`,
        parameters: z.object({
          symbols: z
            .array(symbolRefSchema)
            .min(1)
            .max(MAX_SYMBOLS)
            .optional()
            .describe(
              "Listings to quote; everything the user holds and watches when left out"
            ),
        }),
        async execute({ symbols }) {
          const at = now();

          const account = await positions();

          const positionOf = new Map(
            account.positions.map((position) => [
              symbolKey(position.instrument),
              position,
            ])
          );

          const listings = uniqBy(
            symbols ?? [
              ...account.positions.map(({ instrument }) => ({
                market: instrument.market,
                symbol: instrument.symbol,
              })),
              ...options.watchlist(),
            ],
            symbolKey
          );

          if (listings.length === 0) {
            return {
              text: account.failure
                ? `Nothing to quote: the watchlist is empty and the account could not be read (${account.failure}).`
                : "Nothing to quote: the user holds and watches no listing yet.",
            };
          }

          const read = await Promise.all(
            listings.map(async (symbol) => {
              try {
                const [quote, listing] = await Promise.all([
                  options.quote(symbol),
                  options.marketData.listing(symbol).catch(() => null),
                ]);

                return {
                  symbol,
                  quote,
                  name: listing?.name ?? "",
                  failure: null,
                };
              } catch (error) {
                return {
                  symbol,
                  quote: null,
                  name: "",
                  failure: errorMessage(error),
                };
              }
            })
          );

          const quoted = orderBy(
            read.flatMap(({ symbol, name, quote }): Quoted[] =>
              quote ? [{ symbol, name, quote, moved: quoteChange(quote) }] : []
            ),
            [({ moved }) => moved?.percent ?? Number.NEGATIVE_INFINITY],
            ["desc"]
          );

          const held = quoted.flatMap((row): Held[] => {
            const position = positionOf.get(symbolKey(row.symbol));

            return position
              ? [
                  {
                    ...row,
                    position,
                    worth: positionValue(position, row.quote.last),
                    today: row.moved
                      ? position.quantity * row.moved.change
                      : null,
                  },
                ]
              : [];
          });

          const others = quoted.filter(
            ({ symbol }) => !positionOf.has(symbolKey(symbol))
          );

          const missing = read.filter(({ quote }) => !quote);

          const unmarked = missing.filter(({ symbol }) =>
            positionOf.has(symbolKey(symbol))
          ).length;

          return {
            text: [
              `Quotes as_of ${exchangeTime(Market.TW, at)} Taipei, ${exchangeTime(Market.US, at)} New York, for ${symbols ? "the listings asked for" : "what the user holds and watches"}: each listing's newest session against the close before it, largest rise first`,
              ...(held.length > 0
                ? [
                    "Held, each position marked at its last price:",
                    "listing,name,session,last,change,percent,shares,average,worth,gain,gain percent,today",
                    ...held.map((row) =>
                      [
                        ...quoteCells(row),
                        row.position.quantity,
                        figure(row.position.avgPrice),
                        figure(row.worth.value),
                        signed(row.worth.gain),
                        percent(row.worth.gainPercent),
                        row.today === null ? "n/a" : signed(row.today),
                      ].join(",")
                    ),
                    ...Object.entries(
                      groupBy(held, ({ symbol }) => currencyOf(symbol.market))
                    ).map(([currency, rows]) => totalText(currency, rows)),
                  ]
                : []),
              ...(others.length > 0
                ? [
                    "Not held:",
                    "listing,name,session,last,change,percent",
                    ...others.map((row) => quoteCells(row).join(",")),
                  ]
                : []),
              ...(missing.length > 0
                ? [
                    `No quote: ${missing
                      .map(
                        ({ symbol, failure }) =>
                          `${code(symbol)} (${failure ?? "no source covers its market or has bars for it"})`
                      )
                      .join(
                        "; "
                      )}${unmarked > 0 ? `; the totals leave out the ${unmarked} held among them` : ""}`,
                  ]
                : []),
              ...(account.failure
                ? [
                    `The account could not be read (${account.failure}), so no position is marked.`,
                  ]
                : []),
            ].join("\n"),
          };
        },
      }),
    ],
  });
}
