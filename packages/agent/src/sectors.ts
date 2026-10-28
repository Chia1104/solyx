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
  marketSchema,
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
  RotationAgainst,
  RotationInterval,
  rotationAgainstSchema,
  rotationIntervalSchema,
} from "@solyx/core/rotation";
import type {
  ListingRotation,
  RotationReading,
  RotationSet,
  SectorRotation,
} from "@solyx/core/rotation";
import {
  SECTOR_GROUPS,
  SECTOR_INDICES,
  SECTOR_MOVERS,
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
  /** Every sector index's or fund's session so far in `market`, as the overview's map reads them; `null` while no source covers it. */
  sectors(market: Market): Promise<SectorQuote[] | null>;
  /** Which of a sector's companies moved its market value most over the exchange's last session, as the overview lists them. */
  movers(sector: TwSector): Promise<SectorMovers | null>;
  /** Every Taiwan sector index's rotation against the TAIEX, or a TWSE benchmark that qualifies, as of `through` or the newest session, as the overview's chart reads it; `null` while no source covers Taiwan. */
  rotations(
    through?: string,
    benchmark?: SymbolRef
  ): Promise<RotationSet<SectorRotation> | null>;
  /** Each listing's rotation on adjusted bars against its market's index, its own sector's or one benchmark, as the overview's chart reads it; rejects while no source covers a market or a benchmark does not qualify. */
  listingRotations(
    symbols: readonly SymbolRef[],
    options: {
      through?: string;
      benchmark?: SymbolRef;
      against?: RotationAgainst;
    }
  ): Promise<RotationSet<ListingRotation>>;
  marketData: Pick<MarketData, "candles">;
  /** @default () => new Date() */
  now?: () => Date;
}

const MARKET = Market.TW;

/** The city whose clock each market's times are told on. */
const CITY: Record<Market, string> = {
  [Market.TW]: "Taipei",
  [Market.US]: "New York",
};

/** A market as a sentence names it. */
const MARKET_NAME: Record<Market, string> = {
  [Market.TW]: "Taiwan",
  [Market.US]: "the US",
};

/** What a market's sectors are, as the call's answer heads them. */
const SECTORS_NAME: Record<Market, string> = {
  [Market.TW]: "Taiwan's listed sectors",
  [Market.US]: "The S&P 500's sectors through their Select Sector funds",
};

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
    benchmark: symbolRefSchema
      .optional()
      .describe(
        "A listing or index to read against in the market's index's place, of the same market, such as TW 0050; one that missed sessions over the last year is refused"
      ),
    against: rotationAgainstSchema
      .optional()
      .describe(
        `With symbols: ${RotationAgainst.Sector} reads each TWSE company against its own sector's index, so a listing outside those industries gets no reading; ${RotationAgainst.Market} is the default`
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
  async function benchmarkText(market: Market): Promise<string> {
    const { symbol, name } = BENCHMARK[market];
    const bars = await options.marketData.candles(symbol, Interval.OneDay);
    const last = bars.at(-1);
    const before = bars.at(-2);
    const heading = `${name} (${symbolLabel(symbol)})`;

    if (!last || !before) return `${heading}: no bars to measure it from`;

    return `${heading} on ${candleDate(market, last.time)}: ${last.close}, ${percentChange(last.close / before.close - 1)} on the session before`;
  }

  return defineExtension({
    name: "solyx-sectors",
    tools: [
      defineTool({
        name: AgentToolName.GetSectors,
        replay: "safe",
        description: `One market's sectors in their newest session, Taiwan's unless the call names the US, computed by the app from what the overview's sector map shows: the market's index's last value and move (the ${BENCHMARK[Market.TW].name}; ${BENCHMARK[Market.US].name} in the US), then each sector with its last value, its move from the reference price in points and percent, the value traded and that value's share of what all the sectors traded, largest rise first, with how many rose and fell and each group's share of the trading. Taiwan's are the Taiwan Stock Exchange's ${SECTOR_INDICES[Market.TW].length} industry indices, grouped ${SECTOR_GROUPS[Market.TW].join(", ")}, the last the traditional industries and the rest; they cover TWSE listings only, not the TPEx. The US has no sector index a source quotes, so its ${SECTOR_INDICES[Market.US].length} are the S&P 500's sectors as State Street's Select Sector funds hold them, grouped ${SECTOR_GROUPS[Market.US].join(", ")} by how the economy moves them; what each traded is the fund's own, not its sector's, so its share is of the funds' trading alone. While the session is open these are the session so far, and a sector has no row until it trades. They say nothing of which listings moved them: read those listings before naming any. An index's or fund's symbol reads as a listing's does, so get_candles and get_indicators take it, as TW IX0028 or US XLK, for its bars over days and weeks, and get_rotation reads the US's funds given as symbols. The app draws these sectors as a map under this call, so do not draw them again. Cite these rather than work them out again.`,
        parameters: z.object({
          market: marketSchema
            .default(Market.TW)
            .describe("TW for Taiwan's sectors, US for the S&P 500's"),
        }),
        async execute({ market }) {
          const sectors = await options.sectors(market);

          if (!sectors) {
            return {
              text: `No sectors: no market data source covers ${MARKET_NAME[market]} yet. get_setup says what is missing.`,
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

          const details: GetSectorsDetails = { market, sectors };
          const asOf = `as_of ${exchangeTime(market, now())} ${CITY[market]}`;

          if (session === undefined) {
            return {
              text: `${SECTORS_NAME[market]} ${asOf}: no sector has traded yet in this session.\n${await benchmarkText(market)}`,
              details,
            };
          }

          const untraded = sectors.filter(({ quote }) => !quote);

          return {
            text: [
              `${SECTORS_NAME[market]} ${asOf}, session ${session}; value in ${currencyOf(market)} millions, share of what all the sectors traded`,
              await benchmarkText(market),
              `${moves.filter((move) => move.change > 0).length} sectors up, ${moves.filter((move) => move.change < 0).length} down, ${moves.filter((move) => move.change === 0).length} unchanged`,
              `Share of the trading by group: ${SECTOR_GROUPS[market]
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
              `sector,group,${market === Market.TW ? "index" : "fund"},last,change,percent,value,share`,
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
        description: `Where listings stand on a relative rotation graph against their market's index, as the app computes it from daily bars: by default every Taiwan sector index against the ${BENCHMARK[MARKET].name}, the same chart the overview draws, so do not draw it again, as it stands now or as it stood at the close of a session you name; or, given symbols, each listing against its market's index (the ${BENCHMARK[Market.TW].name} in Taiwan, ${BENCHMARK[Market.US].name} in the US), against its own sector's index, or against one benchmark you name, on prices adjusted for splits and what went ex. The US's sectors are funds rather than indices, so read them as symbols against the market's index: ${SECTOR_INDICES[Market.US].map(({ symbol }) => `US ${symbol}`).join(", ")}, the chart the overview draws for the US. Each reading is standardized over a period of sessions, or of closed weeks, and the last ${ROTATION_TRAIL} bars are its trail, so a reading takes twice the period of bars. The level is not a return against the index and the momentum not the index's: read the legend the call returns. It changes nothing.`,
        parameters: rotationArgumentsSchema,
        async execute({
          interval,
          period: asked,
          symbols,
          through,
          benchmark,
          against,
        }) {
          const period = asked ?? ROTATION_PERIODS[interval][1];
          const asOf = `as_of ${exchangeTime(MARKET, now())} Taipei${through ? `, read as it stood at the close of ${through}` : ""}`;

          if (symbols) {
            const set = await options.listingRotations(symbols, {
              through,
              benchmark,
              against,
            });

            const unread = set.entries
              .filter((entry) => entry.benchmark === null)
              .map(({ symbol }) => symbolLabel(symbol));

            const rows = set.entries.flatMap(
              ({ symbol, benchmark: own, readings }) => {
                const reading = readings.find(
                  (each) => each.interval === interval && each.period === period
                );

                if (!reading || !own) return [];

                // Each against its own sector's index, which the row names since they differ.
                const name =
                  against === RotationAgainst.Sector
                    ? `${symbolLabel(symbol)} vs ${own.symbol}`
                    : symbolLabel(symbol);

                return [{ name, reading }];
              }
            );

            const markets = [...new Set(symbols.map(({ market }) => market))];

            const againstText = benchmark
              ? symbolLabel(benchmark)
              : against === RotationAgainst.Sector
                ? "its own sector's index"
                : markets.map((market) => BENCHMARK[market].name).join(" or ");

            return {
              text: [
                `Rotation of ${rows.length} listings against ${benchmark ? againstText : against === RotationAgainst.Sector ? "each its own sector's index" : "their market's index"} over ${period} ${BAR_NAMES[interval]} ${asOf}: ${rotationLegend(interval, period, againstText)}`,
                ...rotationTable(rows),
                ...(unread.length > 0
                  ? [
                      `No sector index applies to ${unread.join(", ")}: only a TWSE company in an industry with one is read this way.`,
                    ]
                  : []),
              ].join("\n"),
            };
          }

          const set = await options.rotations(through, benchmark);

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
              `Taiwan's listed sectors' rotation against ${benchmark ? symbolLabel(benchmark) : `the ${BENCHMARK[MARKET].name}`} over ${period} ${BAR_NAMES[interval]}${session ? ` to ${session}` : ""} ${asOf}: ${rotationLegend(interval, period, benchmark ? symbolLabel(benchmark) : `the ${BENCHMARK[MARKET].name}`)}`,
              ...rotationTable(rows),
            ].join("\n"),
          };
        },
      }),
    ],
  });
}
