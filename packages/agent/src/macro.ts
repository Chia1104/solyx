import { defineExtension } from "@earendil-works/pi-durable";
import type { Extension } from "@earendil-works/pi-durable";
import { takeRight } from "es-toolkit";
import * as z from "zod";

import { MacroUnit, macroReadings } from "@solyx/core/macro";
import type { MacroSeries } from "@solyx/core/macro";
import {
  Market,
  US_VOLATILITY_INDEX,
  exchangeTime,
  marketSchema,
  symbolLabel,
} from "@solyx/core/market";
import { TreasuryTenor, curveSpread } from "@solyx/core/yields";
import type { YieldCurve } from "@solyx/core/yields";
import { errorMessage } from "@solyx/utils/error";

import { figure, named, percentChange, signedFigure } from "./figures.ts";
import { valueText } from "./macro-text.ts";
import { defineTool } from "./tools.ts";
import { AgentToolName } from "./wire.ts";

export interface MacroToolsOptions {
  /** A market's indicators' figures, as the host keeps them; none for a market no source covers. */
  series(market: Market): Promise<MacroSeries[]>;
  /** US Treasury debt's yield curve at each of the last months' closes, oldest first, as the host keeps it. */
  yields(): Promise<YieldCurve[]>;
  /** @default () => new Date() */
  now?: () => Date;
}

// A year and the period before it, so the newest period shows against the same one last year.
const LISTED_PERIODS = 13;

// Two weeks of sessions.
const LISTED_CURVES = 10;

const UNIT_NAME: Record<MacroUnit, string> = {
  [MacroUnit.Index]: "an index, read by its growth on the year",
  [MacroUnit.UsdMillions]: "USD millions",
  [MacroUnit.Points]: "points",
  [MacroUnit.Percent]: "percent",
  [MacroUnit.Rate]: "percent, a level",
  [MacroUnit.GrowthOnYear]: "percent growth on the year",
  [MacroUnit.Thousands]: "thousands",
};

function seriesText(series: MacroSeries): string[] {
  const { expected, unit } = series;
  // A rate a central bank sets in eighths of a point.
  const digits = unit === MacroUnit.Rate ? 3 : 2;

  return [
    `${named(series.figure)}, of ${named(series.indicator)}, in ${UNIT_NAME[unit]}:`,
    "period,value,on the year,expected",
    ...takeRight(macroReadings(series), LISTED_PERIODS).map(
      ({ period, value, yoy, forecast }) =>
        [
          period,
          figure(value, digits),
          percentChange(yoy),
          figure(forecast, digits),
        ].join(",")
    ),
    ...(expected
      ? [
          `next, ${expected.period}, not out yet: ${valueText[unit](expected.forecast)} expected`,
        ]
      : []),
  ];
}

/** The newest days' yield curves, or why they could not be read. */
async function yieldsText(
  yields: () => Promise<YieldCurve[]>
): Promise<string[]> {
  let curves: YieldCurve[];

  try {
    curves = takeRight(await yields(), LISTED_CURVES);
  } catch (error) {
    return [`US Treasury yields could not be read (${errorMessage(error)}).`];
  }

  if (curves.length === 0) return [];

  const tenors = Object.values(TreasuryTenor);

  return [
    `US Treasury par yields at each day's close, in percent, oldest first; the last column is ten years' less two years':`,
    ["date", ...tenors, "10y less 2y"].join(","),
    ...curves.map((curve) => {
      const spread = curveSpread(curve);

      return [
        curve.date,
        ...tenors.map((tenor) => figure(curve.yields[tenor])),
        spread === null ? figure(null) : signedFigure(spread),
      ].join(",");
    }),
  ];
}

/**
 * `get_macro`: the figures of a market's economic indicators, as the host keeps them, with the
 * growth the app computed, and for the US the Treasury's yield curve. It changes nothing.
 */
export function createMacroTools(options: MacroToolsOptions): Extension {
  const now = options.now ?? (() => new Date());

  return defineExtension({
    name: "solyx-macro",
    tools: [
      defineTool({
        name: AgentToolName.GetMacro,
        replay: "safe",
        description: `The figures of a market's economic indicators over their last ${LISTED_PERIODS} periods, oldest first, with the growth on the year the app computed and what the market expected of each where its source says. Taiwan's come from its statistics agency's database: consumer prices and core consumer prices, exports and imports, export orders, industrial production, the business signal's score and real GDP growth, with no expectations, and neither the purchasing managers' indices nor the official forecast, which get_calendar links to their agency's page. The US's come from Longbridge while the user is signed in to it: the Fed's target rate (the middle of its range, by the day it was decided), CPI and core CPI, PCE and core PCE prices, nonfarm payrolls added, unemployment and average hourly earnings, retail sales against the month before, the ISM's manufacturing and services indices, GDP's advance estimate at an annual rate against the quarter before, producer prices, initial jobless claims (by the week's last day) and the University of Michigan's preliminary consumer sentiment, each with the consensus, and the next period's consensus once its release is scheduled, a few weeks ahead. A period is a month, a quarter, or a day for a decision or a week, and the newest is the last one out, which get_calendar's releases say when the next follows. Growth is "n/a" for a score, a rate or a count. For the US it also gives US Treasury debt's par yields at three months and two, ten and thirty years over the last ${LISTED_CURVES} days, from the Treasury's own files, with how far ten years' stands above two years', below zero while the curve is inverted. The VIX is a quote: get_quotes reads it as ${symbolLabel(US_VOLATILITY_INDEX)}, an index nothing trades. Cite these rather than work them out again.`,
        parameters: z.object({ market: marketSchema.default(Market.TW) }),
        async execute({ market }) {
          const [series, rates] = await Promise.all([
            options.series(market),
            market === Market.US ? yieldsText(options.yields) : [],
          ]);

          const figures =
            series.length === 0
              ? [
                  `No source has ${market}'s economic figures yet. That says nothing of the economy.`,
                ]
              : [
                  `${market} economic figures as_of ${exchangeTime(market, now())}, each figure's last ${LISTED_PERIODS} periods out`,
                  ...series.flatMap(seriesText),
                ];

          return {
            text: [...figures, ...rates].join("\n"),
            details: { market },
          };
        },
      }),
    ],
  });
}
