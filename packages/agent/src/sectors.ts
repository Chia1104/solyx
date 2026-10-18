import { defineExtension } from "@earendil-works/pi-durable";
import type { Extension } from "@earendil-works/pi-durable";
import { orderBy, sumBy } from "es-toolkit";
import * as z from "zod";

import { Interval, candleDate } from "@solyx/core/candles";
import {
  BENCHMARK,
  Market,
  currencyOf,
  exchangeTime,
  symbolLabel,
} from "@solyx/core/market";
import type { MarketData } from "@solyx/core/market-data";
import {
  SectorGroup,
  SECTOR_MOVERS,
  TW_SECTOR_INDICES,
  TwSector,
  sectorMoves,
} from "@solyx/core/sectors";
import type { SectorMovers, SectorQuote } from "@solyx/core/sectors";

import {
  millions,
  named,
  percent,
  percentChange,
  signed,
  signedFigure,
} from "./figures.ts";
import { defineTool } from "./tools.ts";
import { AgentToolName } from "./wire.ts";
import type { GetSectorsDetails } from "./wire.ts";

export interface SectorToolsOptions {
  /** Every Taiwan sector index's session so far, as the overview's map reads them; `null` while no source covers Taiwan. */
  sectors(): Promise<SectorQuote[] | null>;
  /** Which of a sector's companies moved its market value most over the exchange's last session, as the overview lists them. */
  movers(sector: TwSector): Promise<SectorMovers | null>;
  marketData: Pick<MarketData, "candles">;
  /** @default () => new Date() */
  now?: () => Date;
}

const MARKET = Market.TW;

/**
 * `get_sectors`: Taiwan's market by sector, as the host's market data reads the exchange's sector
 * indices and the app computes their moves, so the model cites what the overview's map shows. It
 * changes nothing.
 */
export function createSectorTools(options: SectorToolsOptions): Extension {
  const now = options.now ?? (() => new Date());

  /** The market's own index over its newest daily bar, which is the session under way once it trades. */
  async function benchmarkText(): Promise<string> {
    const { symbol, name } = BENCHMARK[MARKET];
    const bars = await options.marketData.candles(symbol, Interval.OneDay);
    const last = bars.at(-1);
    const before = bars.at(-2);
    const heading = `${name} (${symbolLabel(symbol)})`;

    if (!last || !before) return `${heading}: no bars to measure it from`;

    return `${heading} on ${candleDate(MARKET, last.time)}: ${last.close}, ${percentChange(last.close / before.close - 1)} on the session before`;
  }

  return defineExtension({
    name: "solyx-sectors",
    tools: [
      defineTool({
        name: AgentToolName.GetSectors,
        replay: "safe",
        description: `Taiwan's market by sector in its newest session, computed by the app from what the overview's sector map shows: the ${BENCHMARK[MARKET].name}'s last value and move, then each of the Taiwan Stock Exchange's ${TW_SECTOR_INDICES.length} industry indices with its last value, its move from the reference price in points and percent, the value its listings traded and that value's share of what all the sectors traded, largest rise first, with how many rose and fell and each group's share of the trading: electronics, finance, and other, which is the traditional industries and the rest. While the session is open these are the session so far, and an index has no row until it trades. The indices cover TWSE listings only, not the TPEx, and say nothing of which listings moved them: read those listings before naming any. An index's symbol reads as a listing's does, so get_candles and get_indicators take it, as TW IX0028, for its bars over days and weeks. The app draws these sectors as a map under this call, so do not draw them again. Taiwan only. Cite these rather than work them out again.`,
        parameters: z.object({}),
        async execute() {
          const sectors = await options.sectors();

          if (!sectors) {
            return {
              text: "No sector indices: no market data source covers Taiwan yet. get_setup says what is missing.",
            };
          }

          const moves = orderBy(
            sectorMoves(sectors),
            [(move) => move.percent],
            ["desc"]
          );

          // ISO dates sort as text, and the newest is the session the others are read against.
          const session = moves
            .map((move) => move.quote.date)
            .toSorted()
            .at(-1);

          const details: GetSectorsDetails = { sectors };

          if (session === undefined) {
            return {
              text: `Taiwan's listed sectors as_of ${exchangeTime(MARKET, now())} Taipei: no sector index has traded yet in this session.\n${await benchmarkText()}`,
              details,
            };
          }

          const untraded = sectors.filter(({ quote }) => !quote);

          return {
            text: [
              `Taiwan's listed sectors as_of ${exchangeTime(MARKET, now())} Taipei, session ${session}; value in ${currencyOf(MARKET)} millions, share of what all the sectors traded`,
              await benchmarkText(),
              `${moves.filter((move) => move.change > 0).length} sectors up, ${moves.filter((move) => move.change < 0).length} down, ${moves.filter((move) => move.change === 0).length} unchanged`,
              `Share of the trading by group: ${Object.values(SectorGroup)
                .map(
                  (group) =>
                    `${group} ${percent(
                      sumBy(
                        moves.filter((move) => move.group === group),
                        (move) => move.share
                      )
                    )}`
                )
                .join(", ")}`,
              "sector,group,index,last,change,percent,value,share",
              ...moves.map((move) =>
                [
                  named(move.sector),
                  move.group,
                  move.symbol,
                  move.quote.last,
                  signed(move.change),
                  percentChange(move.percent),
                  millions(move.quote.tradeValue),
                  percent(move.share),
                ].join(",")
              ),
              ...(untraded.length > 0
                ? [
                    `Not traded yet: ${untraded.map(({ sector, symbol }) => `${named(sector)} (${symbol})`).join(", ")}`,
                  ]
                : []),
            ].join("\n"),
            details,
          };
        },
      }),
      defineTool({
        name: AgentToolName.GetSectorMovers,
        replay: "safe",
        description: `Which of one Taiwan sector's companies moved its market value most over the Taiwan Stock Exchange's last session, the same list the overview shows under its sector map: each one's shares as the exchange lists them times its change from the close before, largest move first either way, the top ${SECTOR_MOVERS} named and the rest summed. A sector's index weighs its listings by market value, so these are what moved it; the companies are TWSE's alone, as its index is. It is the last session the exchange has published, which is the one before today's until the afternoon after the close, so name its date. Taiwan only.`,
        parameters: z.object({
          sector: z.enum(TwSector).describe("A sector as get_sectors names it"),
        }),
        async execute({ sector }) {
          const movers = await options.movers(sector);

          if (!movers) {
            return {
              text: `No session the exchange has published lists a company of ${named(sector)}.`,
            };
          }

          const currency = currencyOf(MARKET);

          // A company's part of the move in points of the sector's market value, which add up to it.
          const contribution = (value: number) =>
            percentChange(value / movers.marketValue);

          return {
            text: [
              `${named(sector)} over the Taiwan Stock Exchange's session of ${movers.date}: its companies' shares were worth ${millions(movers.marketValue)} million ${currency} at the close before and moved ${signedFigure(millions(movers.valueChange), 0)} million (${percentChange(movers.valueChange / movers.marketValue)}). By what each one's shares gained, in ${currency} millions, and that in points of the sector's market value, which add up to its move:`,
              "symbol,percent,value change,contribution",
              ...movers.movers.map((mover) =>
                [
                  mover.symbol,
                  percentChange(mover.percent),
                  signedFigure(millions(mover.valueChange), 0),
                  contribution(mover.valueChange),
                ].join(",")
              ),
              ...(movers.rest.companies > 0
                ? [
                    `the other ${movers.rest.companies},,${signedFigure(millions(movers.rest.valueChange), 0)},${contribution(movers.rest.valueChange)}`,
                  ]
                : []),
            ].join("\n"),
          };
        },
      }),
    ],
  });
}
