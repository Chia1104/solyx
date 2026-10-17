import { uniq } from "es-toolkit";
import ky, { isHTTPError } from "ky";
import * as z from "zod";

import { MacroFigure, MacroIndicator, MacroUnit } from "@solyx/core/macro";
import type {
  MacroFiguresProvider,
  MacroObservation,
  MacroSeries,
} from "@solyx/core/macro";
import { Market, exchangeDate } from "@solyx/core/market";

const DGBAS_URL = "https://nstatdb.dgbas.gov.tw/dgbasAll/";

// The database answers within a second, but now and then leaves a request hanging for minutes
// while the same request sent again is answered at once.
const TIMEOUT_MS = 5000;

const RETRIES = 4;

/** How often a table's figures come: by the month or by the quarter. */
const Cycle = { Month: "M", Quarter: "Q" } as const;

type Cycle = (typeof Cycle)[keyof typeof Cycle];

interface Followed {
  figure: MacroFigure;
  indicator: MacroIndicator;
  unit: MacroUnit;
  /** The item of each of the table's dimensions the figure is, by the database's number for it. */
  items: readonly string[];
  /** What the database must name each of those items, so a renumbered table is never read as another figure. */
  names: readonly string[];
}

interface Table {
  /** The database's code for the table. */
  code: string;
  cycle: Cycle;
  /** An indicator's headline figure first. */
  figures: readonly Followed[];
}

/** The tables followed, each by the database's own code, and the figures read from each. */
const TABLES: readonly Table[] = [
  {
    code: "A030601015",
    cycle: Cycle.Month,
    figures: [
      {
        figure: MacroFigure.ConsumerPrices,
        indicator: MacroIndicator.ConsumerPrices,
        unit: MacroUnit.Index,
        items: ["1"],
        names: ["消費者物價總指數_未經季節調整"],
      },
      {
        figure: MacroFigure.CoreConsumerPrices,
        indicator: MacroIndicator.ConsumerPrices,
        unit: MacroUnit.Index,
        items: ["3"],
        names: ["消費者物價總指數(不含蔬果及能源)【即核心物價】_未經季節調整"],
      },
    ],
  },
  {
    code: "A018101010",
    cycle: Cycle.Quarter,
    figures: [
      {
        figure: MacroFigure.GdpGrowth,
        indicator: MacroIndicator.AdvanceGdp,
        unit: MacroUnit.Percent,
        items: ["3"],
        names: ["經濟成長率(%)"],
      },
    ],
  },
  {
    code: "A081201010",
    cycle: Cycle.Month,
    figures: [
      {
        figure: MacroFigure.Exports,
        indicator: MacroIndicator.Trade,
        unit: MacroUnit.UsdMillions,
        items: ["2", "1"],
        names: ["USD(百萬美元)", "出口"],
      },
      {
        figure: MacroFigure.Imports,
        indicator: MacroIndicator.Trade,
        unit: MacroUnit.UsdMillions,
        items: ["2", "2"],
        names: ["USD(百萬美元)", "進口"],
      },
    ],
  },
  {
    code: "A050105010",
    cycle: Cycle.Month,
    figures: [
      {
        figure: MacroFigure.ExportOrders,
        indicator: MacroIndicator.ExportOrders,
        unit: MacroUnit.UsdMillions,
        items: ["2", "1"],
        names: ["美金計價(百萬美元)", "合計"],
      },
    ],
  },
  {
    code: "A050104010",
    cycle: Cycle.Month,
    figures: [
      {
        figure: MacroFigure.IndustrialProduction,
        indicator: MacroIndicator.IndustrialProduction,
        unit: MacroUnit.Index,
        items: ["1"],
        names: ["總指數"],
      },
    ],
  },
  {
    code: "A120101010",
    cycle: Cycle.Month,
    figures: [
      {
        figure: MacroFigure.BusinessSignal,
        indicator: MacroIndicator.BusinessSignal,
        unit: MacroUnit.Points,
        items: ["5"],
        names: ["景氣對策信號(分)"],
      },
    ],
  },
];

// A query names three dimensions whatever its table has, and one left empty takes every item.
const DIMENSIONS = 3;

const itemSchema = z.object({ id: z.string(), name: z.string().trim() });

/**
 * A table's answer: each series under the positions of its items in the dimensions' lists, with a
 * value for every period asked for, in the order the periods are listed.
 */
const answerSchema = z.object({
  data: z.object({
    dataSets: z.tuple([
      z.object({
        series: z.record(
          z.string(),
          z.object({
            observations: z.record(z.string(), z.tuple([z.number()])),
          })
        ),
      }),
    ]),
    structure: z.object({
      dimensions: z.object({
        series: z.array(z.object({ values: z.array(itemSchema) })),
        observation: z.tuple([
          z.object({ values: z.array(z.object({ id: z.string() })) }),
        ]),
      }),
    }),
  }),
});

// A period as the database writes it, `2026-M9` or `2026-Q3`.
const PERIOD = /^(\d{4})-(?:M(\d{1,2})|(Q[1-4]))$/;

/** A period as the app writes it, `2026-09` or `2026-Q3`; `null` for one the database writes another way. */
function readPeriod(id: string): string | null {
  const match = PERIOD.exec(id);

  if (!match) return null;

  const [, year, month, quarter] = match;

  return month === undefined
    ? `${year}-${quarter}`
    : `${year}-${month.padStart(2, "0")}`;
}

/** A month `YYYY-MM` as the database's period of a cycle: `2026-M9`, or the quarter it falls in, `2026-Q3`. */
function periodOf(month: string, cycle: Cycle): string {
  const { year, month: number } = Temporal.PlainYearMonth.from(month);

  return cycle === Cycle.Month
    ? `${year}-M${number}`
    : `${year}-Q${Math.ceil(number / 3)}`;
}

export interface DgbasOptions {
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
  /** @default () => new Date() */
  now?: () => Date;
}

/**
 * The figures of Taiwan's economic indicators from the macro database of the Directorate-General
 * of Budget, Accounting and Statistics, which gathers the other agencies' too and whose API needs
 * no key. It holds levels alone, so growth is the caller's to work out, and it has neither the
 * purchasing managers' indices nor the official forecast.
 */
export function createDgbas(options: DgbasOptions = {}): MacroFiguresProvider {
  const now = options.now ?? (() => new Date());

  const api = ky.create({
    baseUrl: DGBAS_URL,
    fetch: options.fetch,
    timeout: TIMEOUT_MS,
    retry: { limit: RETRIES, retryOnTimeout: true },
    hooks: {
      beforeError: [
        ({ error }) => {
          error.message = isHTTPError(error)
            ? `DGBAS answered ${error.response.status}`
            : `DGBAS: ${error.message}`;

          return error;
        },
      ],
    },
  });

  /** A table's followed figures from `since` through the month it is now. */
  async function read(
    { code, cycle, figures }: Table,
    since: string,
    until: string
  ): Promise<MacroSeries[]> {
    const filter = Array.from({ length: DIMENSIONS }, (_, dimension) =>
      uniq(figures.flatMap(({ items }) => items[dimension] ?? [])).join("+")
    ).join(".");

    const response = await api.get(
      `webMain.aspx?sdmx/${code}/${filter}.${cycle}&startTime=${periodOf(since, cycle)}&endTime=${periodOf(until, cycle)}`
    );

    // A query the database does not take answers the table's own web page, which is no JSON.
    const body: unknown = await response.json().catch(() => undefined);
    const answered = answerSchema.safeParse(body);

    if (!answered.success) {
      throw new Error(`DGBAS: ${code} did not answer its figures`);
    }

    const { dataSets, structure } = answered.data.data;
    const { series: dimensions, observation } = structure.dimensions;
    const periods = observation[0].values.map(({ id }) => readPeriod(id));

    return figures.map((followed): MacroSeries => {
      // Each item's place in its dimension's list, which is how the answer keys its series.
      const places = followed.items.map((item, dimension) => {
        const listed = dimensions[dimension]?.values ?? [];
        const place = listed.findIndex(({ id }) => id === item);

        if (listed[place]?.name !== followed.names[dimension]) {
          throw new Error(
            `DGBAS: ${code} no longer lists ${followed.names[dimension]} as item ${item}`
          );
        }

        return place;
      });

      const values = dataSets[0].series[places.join(":")]?.observations ?? {};

      const listed = periods.map((period, index) => ({
        period,
        value: values[index]?.[0],
      }));

      // A period not out yet answers 0, as every period after the newest one out does.
      const out = listed.findLastIndex(
        ({ value }) => value !== undefined && value !== 0
      );

      const observations = listed
        .slice(0, out + 1)
        .flatMap(({ period, value }): MacroObservation[] =>
          period === null || value === undefined ? [] : [{ period, value }]
        );

      if (observations.length === 0) {
        throw new Error(
          `DGBAS: ${code} has nothing out for ${followed.names.join(" ")} since ${since}`
        );
      }

      return {
        market: Market.TW,
        indicator: followed.indicator,
        figure: followed.figure,
        unit: followed.unit,
        observations,
      };
    });
  }

  return {
    id: "dgbas",
    markets: [Market.TW],

    async series(market, since) {
      if (market !== Market.TW) return [];

      const until = exchangeDate(Market.TW, now()).slice(0, "YYYY-MM".length);

      const tables = await Promise.all(
        TABLES.map((table) => read(table, since, until))
      );

      return tables.flat();
    },
  };
}
