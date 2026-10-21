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
  symbolRefSchema,
} from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { MarketData } from "@solyx/core/market-data";
import {
  Quadrant,
  ROTATION_PERIODS,
  ROTATION_TRAIL,
  PLAYBACK_SESSIONS,
  RotationInterval,
  rotationIntervalSchema,
} from "@solyx/core/rotation";
import type {
  ListingRotation,
  RotationReading,
  RotationSet,
  SectorRotation,
} from "@solyx/core/rotation";
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
  /** Every Taiwan sector index's rotation against the TAIEX as of `through` or the newest session, as the overview's chart reads it; `null` while no source covers Taiwan. */
  rotations(through?: string): Promise<RotationSet<SectorRotation> | null>;
  /** Each listing's rotation against its market's index on adjusted bars, as the overview's chart reads it; rejects while no source covers a market. */
  listingRotations(
    symbols: readonly SymbolRef[],
    through?: string
  ): Promise<RotationSet<ListingRotation>>;
  marketData: Pick<MarketData, "candles">;
  /** @default () => new Date() */
  now?: () => Date;
}

const MARKET = Market.TW;

/** How many listings one call may read, each a daily-bar request. */
const MAX_ROTATION_LISTINGS = 20;

/** Quadrants in the order a rotation runs through them, from where a listing leads. */
const QUADRANT_ORDER = [
  Quadrant.Leading,
  Quadrant.Weakening,
  Quadrant.Lagging,
  Quadrant.Improving,
];

/** What a bar of each interval is called, in the legend and the table. */
const BAR_NAMES: Record<RotationInterval, string> = {
  [RotationInterval.Daily]: "sessions",
  [RotationInterval.Weekly]: "weeks",
};

const rotationArgumentsSchema = z
  .object({
    interval: rotationIntervalSchema
      .default(RotationInterval.Daily)
      .describe(
        `Bars each reading is read over: ${RotationInterval.Daily} for sessions, ${RotationInterval.Weekly} for closed weeks`
      ),
    period: z
      .number()
      .int()
      .optional()
      .describe(
        `Bars each reading is standardized over: ${Object.values(
          RotationInterval
        )
          .map(
            (interval) =>
              `one of ${ROTATION_PERIODS[interval].join(", ")} ${BAR_NAMES[interval]}`
          )
          .join("; ")}; the middle one where left out`
      ),
    symbols: z
      .array(symbolRefSchema)
      .max(MAX_ROTATION_LISTINGS)
      .optional()
      .describe(
        `Listings to read instead of the sectors, up to ${MAX_ROTATION_LISTINGS}, each a daily-bar request`
      ),
    through: z.iso
      .date()
      .optional()
      .describe(
        `A session, YYYY-MM-DD, to read the graph as it stood at its close, within the last ${PLAYBACK_SESSIONS}; the newest where left out`
      ),
  })
  .superRefine(({ interval, period }, context) => {
    const periods = ROTATION_PERIODS[interval];

    if (period !== undefined && !periods.includes(period)) {
      context.addIssue({
        code: "custom",
        path: ["period"],
        message: `One of ${periods.join(", ")} ${BAR_NAMES[interval]}`,
      });
    }
  });

/** One line of the rotation table: where the reading stands, where it was, and its last crossing. */
function rotationRow(name: string, reading: RotationReading) {
  const last = reading.trail.at(-1);
  const first = reading.trail[0];

  if (!last || !first) return null;

  return [
    name,
    reading.quadrant,
    signed(last.level),
    signed(last.momentum),
    reading.transition
      ? `${reading.transition.date} from ${reading.transition.from}`
      : "none in the trail",
    `${signed(first.level)}/${signed(first.momentum)} on ${first.date}`,
  ].join(",");
}

/** Readings grouped by quadrant in `QUADRANT_ORDER`, the highest level first within each, then those with none. */
function rotationTable(
  rows: { name: string; reading: RotationReading }[]
): string[] {
  const ordered = orderBy(
    rows.filter(({ reading }) => reading.quadrant !== null),
    [
      ({ reading }) =>
        reading.quadrant === null
          ? QUADRANT_ORDER.length
          : QUADRANT_ORDER.indexOf(reading.quadrant),
      ({ reading }) => reading.trail.at(-1)?.level ?? 0,
    ],
    ["asc", "desc"]
  );

  const unread = rows.filter(({ reading }) => reading.quadrant === null);

  return [
    "name,quadrant,level,momentum,crossed,trail start (level/momentum)",
    ...ordered.flatMap(({ name, reading }) => rotationRow(name, reading) ?? []),
    ...(unread.length > 0
      ? [`Too few bars: ${unread.map(({ name }) => name).join(", ")}`]
      : []),
  ];
}

/** What the table's columns mean, once per call. */
const rotationLegend = (
  interval: RotationInterval,
  period: number,
  benchmark: string
) => {
  const bars = BAR_NAMES[interval];

  return `the level is how far the listing's price over ${benchmark}'s stands from its own ${period}-${bars.slice(0, -1)} mean, in standard deviations, and the momentum how far the level's latest change stands from its ${period}-${bars.slice(0, -1)} mean; leading is both above zero, weakening a level above zero losing it, lagging both below, improving a level below zero gaining. The trail is the last ${ROTATION_TRAIL} ${bars}${interval === RotationInterval.Weekly ? ", closed weeks only, each dated by its last session" : ""}, and the crossing the last one in it into the quadrant it ends in. A level above zero says the ratio stands above its own recent mean, not that the listing outran ${benchmark} over the period: get_indicators' relative strength says that.`;
};

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
      defineTool({
        name: AgentToolName.GetRotation,
        replay: "safe",
        description: `Where listings stand on a relative rotation graph against their market's index, as the app computes it from daily bars: by default every Taiwan sector index against the ${BENCHMARK[MARKET].name}, the same chart the overview draws, so do not draw it again, as it stands now or as it stood at the close of a session you name; or, given symbols, each listing against its market's index (the ${BENCHMARK[Market.TW].name} in Taiwan, ${BENCHMARK[Market.US].name} in the US), on prices adjusted for splits and what went ex. Each reading is standardized over a period of sessions, or of closed weeks, and the last ${ROTATION_TRAIL} bars are its trail, so a reading takes twice the period of bars. The level is not a return against the index and the momentum not the index's: read the legend the call returns. It changes nothing.`,
        parameters: rotationArgumentsSchema,
        async execute({ interval, period: asked, symbols, through }) {
          const period = asked ?? ROTATION_PERIODS[interval][1];
          const asOf = `as_of ${exchangeTime(MARKET, now())} Taipei${through ? `, read as it stood at the close of ${through}` : ""}`;

          if (symbols) {
            const set = await options.listingRotations(symbols, through);

            const rows = set.entries.flatMap(({ symbol, readings }) => {
              const reading = readings.find(
                (each) => each.interval === interval && each.period === period
              );

              return reading ? [{ name: symbolLabel(symbol), reading }] : [];
            });

            const markets = [...new Set(symbols.map(({ market }) => market))];

            return {
              text: [
                `Rotation of ${rows.length} listings against their market's index over ${period} ${BAR_NAMES[interval]} ${asOf}: ${rotationLegend(interval, period, markets.map((market) => BENCHMARK[market].name).join(" or "))}`,
                ...rotationTable(rows),
              ].join("\n"),
            };
          }

          const set = await options.rotations(through);

          if (!set) {
            return {
              text: "No sector indices: no market data source covers Taiwan yet. get_setup says what is missing.",
            };
          }

          const rows = set.entries.flatMap(({ sector, symbol, readings }) => {
            const reading = readings.find((each) => each.period === period);

            return reading
              ? [{ name: `${named(sector)} (${symbol})`, reading }]
              : [];
          });

          const session = rows
            .flatMap(({ reading }) => reading.trail.at(-1)?.date ?? [])
            .toSorted()
            .at(-1);

          return {
            text: [
              `Taiwan's listed sectors' rotation against the ${BENCHMARK[MARKET].name} over ${period} ${BAR_NAMES[interval]}${session ? ` to ${session}` : ""} ${asOf}: ${rotationLegend(interval, period, `the ${BENCHMARK[MARKET].name}`)}`,
              ...rotationTable(rows),
            ].join("\n"),
          };
        },
      }),
    ],
  });
}
