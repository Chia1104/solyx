import { defineExtension } from "@earendil-works/pi-durable";
import type { Extension } from "@earendil-works/pi-durable";
import { groupBy, orderBy, sumBy, uniqBy } from "es-toolkit";
import * as z from "zod";

import { inTwd } from "@solyx/core/exchange-rate";
import type { ExchangeRate } from "@solyx/core/exchange-rate";
import {
  Market,
  currencyOf,
  exchangeTime,
  symbolKey,
  symbolRefSchema,
  symbolLabel,
} from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { MarketData } from "@solyx/core/market-data";
import { positionValue } from "@solyx/core/order";
import type { Position, PositionValue } from "@solyx/core/order";
import type { ProposingDesk } from "@solyx/core/order-desk";
import { quoteChange } from "@solyx/core/quote";
import type { SessionQuote } from "@solyx/core/quote";
import { errorMessage } from "@solyx/utils/error";

import { figure, percentChange, signedFigure } from "./figures.ts";
import { rateText } from "./macro-text.ts";
import { defineTool } from "./tools.ts";
import { AgentToolName } from "./wire.ts";

export interface QuoteToolsOptions {
  /** A listing's newest session against the close before it, as the app's overview reads it; `null` when no source covers its market or has bars for it. */
  quote(symbol: SymbolRef): Promise<SessionQuote | null>;
  marketData: Pick<MarketData, "listing">;
  watchlist(): SymbolRef[];
  desk: Pick<ProposingDesk, "account">;
  /** The newest close of the US dollar in Taiwan dollars, which totals held in both currencies are read at. */
  exchangeRate(): Promise<ExchangeRate>;
  /** @default () => new Date() */
  now?: () => Date;
}

const MAX_SYMBOLS = 50;

/** Places a price or a sum keeps, past which arithmetic leaves only noise. */
const PRICE_DIGITS = 4;

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
  symbolLabel(symbol),
  name,
  quote.date,
  figure(quote.last, PRICE_DIGITS),
  moved ? signedFigure(moved.change, PRICE_DIGITS) : "n/a",
  percentChange(moved?.percent ?? null),
];

/** What the positions quoted in one currency add up to. */
function totalText(currency: string, held: readonly Held[]): string {
  const value = sumBy(held, ({ worth }) => worth.value);
  const cost = sumBy(held, ({ worth }) => worth.cost);

  return `Held in ${currency}: worth ${figure(value, PRICE_DIGITS)} against a cost of ${figure(cost, PRICE_DIGITS)}, gain ${signedFigure(value - cost, PRICE_DIGITS)} (${percentChange(cost === 0 ? null : (value - cost) / cost)}), today ${signedFigure(
    sumBy(held, ({ today }) => today ?? 0),
    PRICE_DIGITS
  )}`;
}

/** What the positions held in more than one currency are worth together in Taiwan dollars, or why that cannot be said. */
async function allText(
  held: readonly Held[],
  exchangeRate: () => Promise<ExchangeRate>
): Promise<string> {
  try {
    const rate = await exchangeRate();

    const worth = sumBy(held, ({ symbol, worth: { value } }) =>
      inTwd(value, currencyOf(symbol.market), rate)
    );

    return `Held in all, in TWD at ${rateText(rate)}: worth ${figure(worth, 0)}`;
  } catch (error) {
    return `Held in all could not be put in TWD, since USD/TWD could not be read (${errorMessage(error)})`;
  }
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
        description: `Today at a glance for many listings at once, as the app's overview shows its moves: each listing's newest session against the close before it (its date, last price, change and percent), largest rise first, for everything the user holds and watches unless symbols names others. A held listing also comes with its position marked at the last price, computed by the app: shares, average price, what it is worth, its open gain against what it cost and what the session's move made of it, with each currency's totals and, where they are held in both, what they are worth together in TWD at the US dollar's newest close. A session still open has not closed at its last price, and outside one the newest session is the last that traded. Each listing costs the market data source a request, so name symbols rather than quote a long watchlist for a few of them. For bars, levels and indicators read get_candles and get_indicators. Cite these rather than work them out again.`,
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

          const byCurrency = groupBy(held, ({ symbol }) =>
            currencyOf(symbol.market)
          );

          const all =
            Object.keys(byCurrency).length > 1
              ? await allText(held, options.exchangeRate)
              : null;

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
                        figure(row.position.avgPrice, PRICE_DIGITS),
                        figure(row.worth.value, PRICE_DIGITS),
                        signedFigure(row.worth.gain, PRICE_DIGITS),
                        percentChange(row.worth.gainPercent),
                        row.today === null
                          ? "n/a"
                          : signedFigure(row.today, PRICE_DIGITS),
                      ].join(",")
                    ),
                    ...Object.entries(byCurrency).map(([currency, rows]) =>
                      totalText(currency, rows)
                    ),
                    ...(all ? [all] : []),
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
                          `${symbolLabel(symbol)} (${failure ?? "no source covers its market or has bars for it"})`
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
