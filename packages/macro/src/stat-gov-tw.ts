import { uniq } from "es-toolkit";
import ky, { isHTTPError } from "ky";
import * as z from "zod";

import { EventTiming } from "@solyx/core/calendar";
import { MacroIndicator } from "@solyx/core/macro";
import type { MacroCalendarProvider, MacroRelease } from "@solyx/core/macro";
import { Market } from "@solyx/core/market";

const STAT_GOV_TW_URL = "https://www.stat.gov.tw/";

/** The calendar page's own node, which every agency's calendar is asked for through. */
const CALENDAR_NODE = "3717";

/** The Republic of China calendar counts its years from 1912. */
const ROC_YEAR_OFFSET = 1911;

/** The releases followed, each by its agency's code and the id the portal gives the release. */
const RELEASES: { agency: string; id: string; indicator: MacroIndicator }[] = [
  // Directorate-General of Budget, Accounting and Statistics
  { agency: "4527", id: "166", indicator: MacroIndicator.ConsumerPrices },
  { agency: "4527", id: "1331", indicator: MacroIndicator.AdvanceGdp },
  { agency: "4527", id: "158", indicator: MacroIndicator.Gdp },
  { agency: "4527", id: "160", indicator: MacroIndicator.EconomicForecast },
  { agency: "4527", id: "149", indicator: MacroIndicator.Unemployment },
  // Ministry of Finance
  { agency: "A07000000D", id: "107", indicator: MacroIndicator.Trade },
  // Ministry of Economic Affairs
  {
    agency: "A13000000G",
    id: "1110",
    indicator: MacroIndicator.IndustrialProduction,
  },
  { agency: "A13000000G", id: "207", indicator: MacroIndicator.ExportOrders },
  // National Development Council
  {
    agency: "A41000000G",
    id: "257",
    indicator: MacroIndicator.BusinessSignal,
  },
  {
    agency: "A41000000G",
    id: "1573",
    indicator: MacroIndicator.PurchasingManagers,
  },
];

const AGENCIES = uniq(RELEASES.map(({ agency }) => agency));

// The page carries its calendar as the data its script renders, from this assignment to the script's end.
const CALENDAR_START = "var VueData = ";

const CALENDAR_END = "</script>";

/** One release's calendar: twelve months from the calendar's first, each with the days it comes out. */
const releaseSchema = z.object({
  ContentUrl: z.string(),
  timedatas: z.array(
    z.array(z.object({ date: z.string(), notice: z.string() }))
  ),
});

const calendarSchema = z.object({
  /** The first month's year, on the Republic of China calendar. */
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  list: z.array(z.unknown()),
});

const RELEASE_ID = /MetaI_D=(\d+)/;

// A day of the month, or the latest day it may come: `23`, `30日以前`.
const RELEASE_DAY = /^(\d{1,2})日?(以前)?$/;

// A period on the Republic of China calendar: a month `11509`, a quarter `115Q3` or a year `115年`.
const PERIOD = /(\d{3})(?:(\d{2})|Q([1-4])|年)/g;

/** The latest period a notice such as `(11509)` or `(113~115Q3)` names, on the Gregorian calendar. */
function latestPeriod(notice: string): string | null {
  const last = [...notice.matchAll(PERIOD)].at(-1);

  if (!last) return null;

  const [, rocYear, month, quarter] = last;
  const year = Number(rocYear) + ROC_YEAR_OFFSET;

  if (month !== undefined) return `${year}-${month}`;

  if (quarter !== undefined) return `${year}-Q${quarter}`;

  return String(year);
}

/** The releases a calendar page lists that are followed, each day it names that is a day of its month. */
function followedReleases(page: string): MacroRelease[] {
  const start = page.indexOf(CALENDAR_START);

  if (start === -1) throw new Error("stat.gov.tw: no calendar on the page");

  const json = page
    .slice(start + CALENDAR_START.length, page.indexOf(CALENDAR_END, start))
    .trim()
    .replace(/;$/, "");

  const calendar = calendarSchema.parse(JSON.parse(json));

  const first = Temporal.PlainYearMonth.from({
    year: calendar.year + ROC_YEAR_OFFSET,
    month: calendar.month,
  });

  return calendar.list.flatMap((entry) => {
    const parsed = releaseSchema.safeParse(entry);

    if (!parsed.success) return [];

    const id = RELEASE_ID.exec(parsed.data.ContentUrl)?.[1];
    const followed = RELEASES.find((release) => release.id === id);

    if (!followed) return [];

    return parsed.data.timedatas.flatMap((days, index) => {
      const month = first.add({ months: index });

      return days.flatMap(({ date, notice }): MacroRelease[] => {
        const day = RELEASE_DAY.exec(date.trim());

        if (!day || Number(day[1]) > month.daysInMonth) return [];

        return [
          {
            market: Market.TW,
            indicator: followed.indicator,
            date: month.toPlainDate({ day: Number(day[1]) }).toString(),
            timing: day[2] ? EventTiming.Deadline : EventTiming.Set,
            period: latestPeriod(notice),
          },
        ];
      });
    });
  });
}

export interface StatGovTwOptions {
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
}

/** Taiwan's economic releases from the national statistics portal's calendar, which needs no key. */
export function createStatGovTw(
  options: StatGovTwOptions = {}
): MacroCalendarProvider {
  const api = ky.create({
    baseUrl: STAT_GOV_TW_URL,
    fetch: options.fetch,
    hooks: {
      beforeError: [
        ({ error }) => {
          error.message = isHTTPError(error)
            ? `stat.gov.tw answered ${error.response.status}`
            : `stat.gov.tw: ${error.message}`;

          return error;
        },
      ],
    },
  });

  return {
    id: "stat-gov-tw",
    markets: [Market.TW],

    async releases(market, since) {
      if (market !== Market.TW) return [];

      const pages = await Promise.all(
        AGENCIES.map((agency) =>
          api
            .get("News_NoticeCalendar.aspx", {
              searchParams: {
                n: CALENDAR_NODE,
                Dept: agency,
                page: 1,
                PageSize: 50,
              },
            })
            .text()
        )
      );

      return pages
        .flatMap(followedReleases)
        .filter(({ date }) => date >= since)
        .toSorted((a, b) => a.date.localeCompare(b.date));
    },
  };
}
