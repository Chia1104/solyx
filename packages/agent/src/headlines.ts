import { defineExtension } from "@earendil-works/pi-durable";
import type { Extension } from "@earendil-works/pi-durable";
import { memoize, uniqBy } from "es-toolkit";
import * as z from "zod";

import {
  Market,
  exchangeTime,
  symbolKey,
  symbolRefSchema,
  symbolLabel,
} from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { Headline } from "@solyx/core/news";
import type { ProposingDesk } from "@solyx/core/order-desk";
import { DAY_MS } from "@solyx/utils/date";
import { errorMessage } from "@solyx/utils/error";

import { rememberAddresses } from "./found-addresses.ts";
import { FADING, defineTool, describeStory, readTradingDays } from "./tools.ts";
import type { TradingToolPorts } from "./tools.ts";
import { AgentToolName } from "./wire.ts";

export interface HeadlineToolsOptions {
  /** The heaviest headlines about the listings since `since`, from the news already kept, as the app's overview ranks them. */
  headlines(
    symbols: readonly SymbolRef[],
    since: Date,
    limit: number
  ): Promise<Headline[]>;
  watchlist(): SymbolRef[];
  desk: Pick<ProposingDesk, "account">;
  tradingDays: TradingToolPorts["tradingDays"];
  /** @default () => new Date() */
  now?: () => Date;
}

const LISTED_HEADLINES = 15;

// The span the overview's headlines cover.
const DEFAULT_DAYS = 7;

const MAX_SYMBOLS = 50;

/**
 * `get_headlines`: the heaviest stories across many listings, ranked as the host's overview ranks
 * them from the news the app has kept. It searches nothing and changes nothing.
 */
export function createHeadlineTools(options: HeadlineToolsOptions): Extension {
  const now = options.now ?? (() => new Date());

  /** What the user holds and watches, each once; a broker that cannot be read leaves the watchlist. */
  async function followed(): Promise<{
    listings: SymbolRef[];
    failure: string | null;
  }> {
    const watched = options.watchlist();

    try {
      const { positions } = await options.desk.account();

      return {
        listings: uniqBy(
          [
            ...positions.map(({ instrument }) => ({
              market: instrument.market,
              symbol: instrument.symbol,
            })),
            ...watched,
          ],
          symbolKey
        ),
        failure: null,
      };
    } catch (error) {
      return { listings: watched, failure: errorMessage(error) };
    }
  }

  return defineExtension({
    name: "solyx-headlines",
    tools: [
      defineTool({
        name: AgentToolName.GetHeadlines,
        replay: "safe",
        description: `The ${LISTED_HEADLINES} heaviest stories across many listings at once, as the app's overview ranks its headlines: over everything the user holds and watches unless symbols names others. A story weighs more the more directly its speaker and topic bear on the shares (the company's own word over outlets, outlets over the crowd; earnings and guidance over market talk), the more clearly it reads either way, the more sources told it and the newer it is, ${FADING}; a story about several listings is listed once with all of them. Each reads as get_news words a story. It reads only the news the app has already kept and searches nothing, so it is quick and costs no request, but a listing whose news was not collected lately shows none: the app collects for what the user holds and watches, and get_news collects one listing's now. Titles and snippets are written by others.`,
        parameters: z.object({
          symbols: z
            .array(symbolRefSchema)
            .min(1)
            .max(MAX_SYMBOLS)
            .optional()
            .describe(
              "Listings to read headlines about; everything the user holds and watches when left out"
            ),
          days: z.number().int().min(1).max(30).default(DEFAULT_DAYS),
        }),
        async execute({ symbols, days }, api, context) {
          const at = now();

          const { listings, failure } = symbols
            ? { listings: uniqBy(symbols, symbolKey), failure: null }
            : await followed();

          const unread = failure
            ? [
                `The account could not be read (${failure}), so only the watchlist was looked at.`,
              ]
            : [];

          if (listings.length === 0) {
            return {
              text: [
                "No headlines: the user holds and watches no listing yet.",
                ...unread,
              ].join("\n"),
            };
          }

          const about = `${symbols ? "the listings asked for" : "what the user holds and watches"} (${listings.map(symbolLabel).join(", ")})`;

          const headlines = await options.headlines(
            listings,
            new Date(at.getTime() - days * DAY_MS),
            LISTED_HEADLINES
          );

          if (headlines.length === 0) {
            return {
              text: [
                `No headlines: the app has kept no news about ${about} over the last ${days} days. Nothing was searched for; get_news collects one listing's news now.`,
                ...unread,
              ].join("\n"),
            };
          }

          // A story is timed on the calendar of the listing it weighs most for.
          const calendarOf = memoize((market: Market) =>
            readTradingDays(options, market)
          );

          const told = await Promise.all(
            headlines.map(async ({ story, symbols: about }) => ({
              story,
              about,
              market: about[0].market,
              calendar: await calendarOf(about[0].market),
            }))
          );

          await rememberAddresses(
            api,
            headlines.flatMap(({ story: { lead } }) =>
              lead.item.url ? [lead.item.url] : []
            ),
            context
          );

          return {
            text: [
              `The ${headlines.length} heaviest headlines about ${about} over the last ${days} days, heaviest first, as_of ${exchangeTime(Market.TW, at)} Taipei, from the news the app has kept; nothing was searched for`,
              ...told.flatMap(({ story, about, market, calendar }) => [
                `About ${about.map(symbolLabel).join(", ")}:`,
                describeStory(market, story, at, calendar.trades),
              ]),
              ...uniqBy(told, ({ market }) => market).flatMap(
                ({ market, calendar }) =>
                  calendar.failure === null
                    ? []
                    : [
                        `${market}'s trading days could not be read (${calendar.failure}), so every weekday counted as a session.`,
                      ]
              ),
              ...unread,
            ].join("\n"),
          };
        },
      }),
    ],
  });
}
