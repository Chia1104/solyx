import { groupBy, minBy, sortBy } from "es-toolkit";
import * as z from "zod";

import { EventTiming } from "@solyx/core/calendar";
import { MacroFigure, MacroIndicator, MacroUnit } from "@solyx/core/macro";
import type {
  MacroCalendarProvider,
  MacroFiguresProvider,
  MacroRelease,
  MacroSeries,
} from "@solyx/core/macro";
import { Market, exchangeDate, exchangeTime } from "@solyx/core/market";
import type { Longbridge } from "@solyx/longbridge/client";

/** How a series' periods come, which says how its period is written. */
const Cycle = {
  Month: "month",
  Quarter: "quarter",
  /** A week's, named by its last day. */
  Week: "week",
  /** A central bank's decisions, named by the day each was announced. */
  Decision: "decision",
} as const;

type Cycle = (typeof Cycle)[keyof typeof Cycle];

interface Followed {
  /** Longbridge's code for the series. */
  code: string;
  /** What Longbridge names the series in English, so a code put to another series fails rather than passing it off as this one. */
  name: string;
  indicator: MacroIndicator;
  figure: MacroFigure;
  unit: MacroUnit;
  cycle: Cycle;
}

/** The series followed, each by Longbridge's own code, an indicator's headline figure first. */
const FOLLOWED: readonly Followed[] = [
  {
    code: "30771885",
    name: "United States, Policy Rates, Fed Funds Target Rate",
    indicator: MacroIndicator.PolicyRate,
    figure: MacroFigure.PolicyRate,
    unit: MacroUnit.Rate,
    cycle: Cycle.Decision,
  },
  {
    code: "30771871",
    name: "United States, CPI - All Urban Samples: All Items, Chg Y/Y",
    indicator: MacroIndicator.ConsumerPrices,
    figure: MacroFigure.ConsumerPrices,
    unit: MacroUnit.GrowthOnYear,
    cycle: Cycle.Month,
  },
  {
    code: "30771867",
    name: "United States, CPI, All items less food and energy, Chg Y/Y, Price Index",
    indicator: MacroIndicator.ConsumerPrices,
    figure: MacroFigure.CoreConsumerPrices,
    unit: MacroUnit.GrowthOnYear,
    cycle: Cycle.Month,
  },
  {
    code: "30771701",
    name: "United States, Personal Consumption Expenditure, Chg Y/Y",
    indicator: MacroIndicator.PersonalIncome,
    figure: MacroFigure.PcePrices,
    unit: MacroUnit.GrowthOnYear,
    cycle: Cycle.Month,
  },
  {
    code: "30771724",
    name: "United States, Personal Consumption Expenditure, Personal consumption expenditures less food and energy, Chg Y/Y",
    indicator: MacroIndicator.PersonalIncome,
    figure: MacroFigure.CorePcePrices,
    unit: MacroUnit.GrowthOnYear,
    cycle: Cycle.Month,
  },
  {
    code: "30771890",
    name: "United States, Employment, Nonfarm payroll, total, Absolute change",
    indicator: MacroIndicator.Employment,
    figure: MacroFigure.PayrollsAdded,
    unit: MacroUnit.Thousands,
    cycle: Cycle.Month,
  },
  {
    code: "30771865",
    name: "United States, Unemployment, Rate",
    indicator: MacroIndicator.Employment,
    figure: MacroFigure.Unemployment,
    unit: MacroUnit.Rate,
    cycle: Cycle.Month,
  },
  {
    code: "30771722",
    name: "United States, Average Earnings YY, Chg Y/Y",
    indicator: MacroIndicator.Employment,
    figure: MacroFigure.HourlyEarnings,
    unit: MacroUnit.GrowthOnYear,
    cycle: Cycle.Month,
  },
  {
    code: "30771869",
    name: "United States, Retail Sales, Total including food services, Chg P/P",
    indicator: MacroIndicator.RetailSales,
    figure: MacroFigure.RetailSales,
    unit: MacroUnit.Percent,
    cycle: Cycle.Month,
  },
  {
    code: "30771942",
    name: "United States, ISM Manufacturing, PMI total",
    indicator: MacroIndicator.ManufacturingSurvey,
    figure: MacroFigure.ManufacturingPmi,
    unit: MacroUnit.Points,
    cycle: Cycle.Month,
  },
  {
    code: "30771978",
    name: "United States, ISM Non-manufacturing, NMI/PMI",
    indicator: MacroIndicator.ServicesSurvey,
    figure: MacroFigure.ServicesPmi,
    unit: MacroUnit.Points,
    cycle: Cycle.Month,
  },
  {
    code: "30771685",
    name: "United States, GDP, Total-adv, Chg P/P",
    indicator: MacroIndicator.AdvanceGdp,
    figure: MacroFigure.GdpAnnualized,
    unit: MacroUnit.Percent,
    cycle: Cycle.Quarter,
  },
  {
    code: "30771924",
    name: "United States, Producer Prices, Final demand, Chg Y/Y",
    indicator: MacroIndicator.ProducerPrices,
    figure: MacroFigure.ProducerPrices,
    unit: MacroUnit.GrowthOnYear,
    cycle: Cycle.Month,
  },
  {
    code: "30771888",
    name: "United States, Jobless Claims, National, Initial",
    indicator: MacroIndicator.JoblessClaims,
    figure: MacroFigure.InitialClaims,
    unit: MacroUnit.Thousands,
    cycle: Cycle.Week,
  },
  {
    code: "30772023",
    name: "United States, University of Michigan, Total-prelim, Volume Index",
    indicator: MacroIndicator.ConsumerSentiment,
    figure: MacroFigure.ConsumerSentiment,
    unit: MacroUnit.Points,
    cycle: Cycle.Month,
  },
];

// Its names in English, which tell a series' measure apart where its Chinese names of several read alike.
const LANGUAGE = "en";

// The most points it answers a request: two years of a weekly series, eight of a monthly one.
const LIMIT = 100;

// A window reads the schedule and the figures together, both from the same series, so one read
// serves both for a while.
const SHARED_MS = 5 * 60_000;

/** A period's release: what came out, what was expected and when, each figure as decimal text, empty until known. */
const pointSchema = z.object({
  actual_data: z.string().nullable(),
  estimated_data: z.string().nullable(),
  published_time: z.string(),
  observation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
});

const historySchema = z.object({
  indicator: z.object({
    indicator_name: z.string(),
    indicator_data: z.array(z.unknown()),
  }),
});

interface Point {
  period: string;
  released: Date;
  actual: number | null;
  forecast: number | null;
}

const figureOf = (text: string | null): number | null =>
  text === null || text.trim() === "" || !Number.isFinite(Number(text))
    ? null
    : Number(text);

/** A release's time, which Longbridge writes without a zone where it means UTC. */
function releasedAt(text: string): Date | null {
  const at = new Date(/(Z|[+-]\d{2}:\d{2})$/.test(text) ? text : `${text}Z`);

  return Number.isNaN(at.getTime()) ? null : at;
}

/** A point's period as the app writes it, from the first day Longbridge dates it by. */
function periodOf(observed: string, released: Date, cycle: Cycle): string {
  const day = observed.slice(0, "YYYY-MM-DD".length);

  return {
    [Cycle.Month]: () => day.slice(0, "YYYY-MM".length),
    [Cycle.Quarter]: () =>
      `${day.slice(0, 4)}-Q${Math.ceil(Number(day.slice(5, 7)) / 3)}`,
    [Cycle.Week]: () => day,
    [Cycle.Decision]: () => exchangeDate(Market.US, released),
  }[cycle]();
}

export interface LongbridgeMacroOptions {
  /** The sign-in's HTTP API, which rejects while signed out. */
  api: Pick<Longbridge, "read">;
  /** @default Date.now */
  now?: () => number;
}

/**
 * The US's economic releases from Longbridge's macro data on the user's sign-in: each followed
 * series with what the market expected of each period, its release's time, and the next period
 * once a release is scheduled, which Longbridge lists a few weeks ahead.
 */
export function createLongbridgeMacro({
  api,
  now = Date.now,
}: LongbridgeMacroOptions): MacroCalendarProvider & MacroFiguresProvider {
  /** A series' newest points, oldest first. */
  async function points({ code, name, cycle }: Followed): Promise<Point[]> {
    const { indicator } = await api.read(
      `/v2/quote/macrodata/${code}`,
      { limit: String(LIMIT), sort: "desc" },
      historySchema,
      `the figures of ${name}`,
      LANGUAGE
    );

    if (indicator.indicator_name !== name) {
      throw new Error(`Longbridge no longer names series ${code} ${name}`);
    }

    const read = indicator.indicator_data.flatMap((row): Point[] => {
      const point = pointSchema.safeParse(row);
      const released = point.success && releasedAt(point.data.published_time);

      return point.success && released
        ? [
            {
              period: periodOf(point.data.observation_date, released, cycle),
              released,
              actual: figureOf(point.data.actual_data),
              forecast: figureOf(point.data.estimated_data),
            },
          ]
        : [];
    });

    return sortBy(read, [({ released }) => released.getTime()]);
  }

  let shared:
    | {
        at: number;
        read: Promise<{ followed: Followed; points: Point[] }[]>;
      }
    | undefined;

  /** Every followed series' newest points, each beside the series it is of, read once for the schedule and the figures alike. */
  function everyPoint() {
    const at = now();

    if (shared && at - shared.at < SHARED_MS) return shared.read;

    const read = Promise.all(
      FOLLOWED.map(async (followed) => ({
        followed,
        points: await points(followed),
      }))
    );

    shared = { at, read };

    // A read that failed is asked again by the next caller rather than kept.
    read.catch(() => {
      if (shared?.read === read) shared = undefined;
    });

    return read;
  }

  return {
    id: "longbridge-macro",
    markets: [Market.US],

    async releases(market, since) {
      if (market !== Market.US) return [];

      const released = (await everyPoint()).flatMap(
        ({ followed, points: read }) =>
          read.map((point) => ({
            followed,
            point,
            date: exchangeDate(Market.US, point.released),
          }))
      );

      // An indicator's figures come out together, so its release is one a day, named by its headline's period.
      const releases = Object.values(
        groupBy(
          released.filter(({ date }) => date >= since),
          ({ followed, date }) => `${followed.indicator}:${date}`
        )
      ).flatMap(([headline]): MacroRelease[] =>
        headline
          ? [
              {
                market: Market.US,
                indicator: headline.followed.indicator,
                date: headline.date,
                time: exchangeTime(Market.US, headline.point.released).slice(
                  "YYYY-MM-DD ".length
                ),
                timing: EventTiming.Set,
                period: headline.point.period,
                page: null,
              },
            ]
          : []
      );

      return sortBy(releases, [({ date }) => date, ({ time }) => time]);
    },

    async series(market, since) {
      if (market !== Market.US) return [];

      const first = `${since}-01`;

      return (await everyPoint()).map(
        ({ followed, points: read }): MacroSeries => {
          const observations = read.flatMap(
            ({ period, released, actual, forecast }) =>
              actual === null || exchangeDate(Market.US, released) < first
                ? []
                : [{ period, value: actual, forecast }]
          );

          if (observations.length === 0) {
            throw new Error(
              `Longbridge has nothing out for ${followed.name} since ${since}`
            );
          }

          const next = minBy(
            read.filter(
              ({ actual, forecast }) => actual === null && forecast !== null
            ),
            ({ released }) => released.getTime()
          );

          return {
            market: Market.US,
            indicator: followed.indicator,
            figure: followed.figure,
            unit: followed.unit,
            observations,
            expected:
              next && next.forecast !== null
                ? { period: next.period, forecast: next.forecast }
                : null,
          };
        }
      );
    },
  };
}
