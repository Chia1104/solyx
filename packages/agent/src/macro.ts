import { defineExtension } from "@earendil-works/pi-durable";
import type { Extension } from "@earendil-works/pi-durable";
import { takeRight } from "es-toolkit";
import * as z from "zod";

import { MacroUnit, macroReadings } from "@solyx/core/macro";
import type { MacroSeries } from "@solyx/core/macro";
import { Market, exchangeTime, marketSchema } from "@solyx/core/market";

import { figure, named, percentChange } from "./figures.ts";
import { defineTool } from "./tools.ts";
import { AgentToolName } from "./wire.ts";

export interface MacroToolsOptions {
  /** A market's indicators' figures, as the host keeps them; none for a market no source covers. */
  series(market: Market): Promise<MacroSeries[]>;
  /** @default () => new Date() */
  now?: () => Date;
}

// A year and the period before it, so the newest period shows against the same one last year.
const LISTED_PERIODS = 13;

const UNIT_NAME: Record<MacroUnit, string> = {
  [MacroUnit.Index]: "an index, read by its growth on the year",
  [MacroUnit.UsdMillions]: "USD millions",
  [MacroUnit.Points]: "points",
  [MacroUnit.Percent]: "percent",
};

function seriesText(series: MacroSeries): string[] {
  return [
    `${named(series.figure)}, of ${named(series.indicator)}, in ${UNIT_NAME[series.unit]}:`,
    "period,value,on the year",
    ...takeRight(macroReadings(series), LISTED_PERIODS).map(
      ({ period, value, yoy }) =>
        [period, figure(value), percentChange(yoy)].join(",")
    ),
  ];
}

/**
 * `get_macro`: the figures of a market's economic indicators, as the host keeps them from its
 * statistics agency's database, with the growth the app computed. It changes nothing.
 */
export function createMacroTools(options: MacroToolsOptions): Extension {
  const now = options.now ?? (() => new Date());

  return defineExtension({
    name: "solyx-macro",
    tools: [
      defineTool({
        name: AgentToolName.GetMacro,
        replay: "safe",
        description: `The figures of a market's economic indicators over their last ${LISTED_PERIODS} periods, oldest first, from its statistics agency's database, with the growth on the year the app computed: Taiwan's consumer prices and core consumer prices, exports and imports, export orders, industrial production, the business signal's score and real GDP growth. A period is a month, or a quarter for GDP, and the newest is the last one out, which get_calendar's releases say when the next follows. Growth is "n/a" for a score or a rate. It has no forecast of any figure and no consensus, and neither the purchasing managers' indices nor the official forecast, which get_calendar links to their agency's page. Taiwan only for now. Cite these rather than work them out again.`,
        parameters: z.object({ market: marketSchema.default(Market.TW) }),
        async execute({ market }) {
          const series = await options.series(market);

          if (series.length === 0) {
            return {
              text: `No source has ${market}'s economic figures yet. That says nothing of the economy.`,
              details: { market },
            };
          }

          return {
            text: [
              `${market} economic figures as_of ${exchangeTime(market, now())}, each figure's last ${LISTED_PERIODS} periods out`,
              ...series.flatMap(seriesText),
            ].join("\n"),
            details: { market },
          };
        },
      }),
    ],
  });
}
