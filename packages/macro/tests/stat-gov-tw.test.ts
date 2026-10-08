import { expect, test } from "vite-plus/test";

import { EventTiming } from "@solyx/core/calendar";
import { MacroIndicator } from "@solyx/core/macro";
import { Market } from "@solyx/core/market";

import { createStatGovTw } from "../src/stat-gov-tw.ts";

type Days = { date: string; time?: string; notice: string }[];

/** One release as the calendar lists it, its days by month from the calendar's first. */
const release = (id: string, name: string, months: Days[]) => ({
  ContentUrl: `https://www.stat.gov.tw/News_NoticeCalendar_Content_temp.aspx?MetaI_D=${id}&year=2026&n=3717`,
  DeptName: "Agency",
  name,
  category: "Category",
  IsControlled: true,
  timedatas: [
    ...months,
    ...Array.from({ length: 12 - months.length }, () => []),
  ],
});

/** A calendar page as the portal serves it, its data assigned in a script. */
const page = (list: unknown[], year = 115, month = 10) =>
  `<html><body><div id="app"></div><script>var deptdata = ['all','4527'];var VueData = ${JSON.stringify({ list, isdefalt: true, year, month, today: { month, day: 8 } })}</script></body></html>`;

/** Answers each agency's page with the one given for its code, and an empty calendar otherwise. */
function fakePortal(pages: Record<string, { status?: number; body: string }>) {
  const sent: URL[] = [];

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(new Request(input, init).url);

    sent.push(url);

    const answer = pages[url.searchParams.get("Dept") ?? ""] ?? {
      body: page([]),
    };

    return new Response(answer.body, {
      status: answer.status ?? 200,
      headers: { "content-type": "text/html" },
    });
  };

  return { sent, statGovTw: createStatGovTw({ fetch }) };
}

test("reads the followed releases of each agency from a day on, soonest first", async () => {
  const { sent, statGovTw } = fakePortal({
    "4527": {
      body: page([
        release("166", "消費者物價指數", [
          [{ date: "7", time: "16:00", notice: "(11509)" }],
          [{ date: "5", time: "16:00", notice: "(11510)" }],
        ]),
        release("158", "國內生產毛額", [
          [],
          [{ date: "30日以前", time: "16:00", notice: "(113~115Q3)" }],
        ]),
        release("160", "經濟預測", [
          [],
          [{ date: "30日以前", time: "16:00", notice: "(115Q4~116年)" }],
        ]),
        // Not followed.
        release("169", "營造工程物價指數", [
          [{ date: "7", time: "16:00", notice: "(11509)" }],
        ]),
      ]),
    },
    A41000000G: {
      body: page([
        release("1573", "台灣採購經理人指數", [
          [{ date: "1", notice: "(11509)" }],
          [{ date: "3日以前", notice: "(11510)" }],
        ]),
      ]),
    },
  });

  expect(await statGovTw.releases(Market.TW, "2026-10-05")).toEqual([
    {
      market: Market.TW,
      indicator: MacroIndicator.ConsumerPrices,
      date: "2026-10-07",
      timing: EventTiming.Set,
      period: "2026-09",
    },
    {
      market: Market.TW,
      indicator: MacroIndicator.PurchasingManagers,
      date: "2026-11-03",
      timing: EventTiming.Deadline,
      period: "2026-10",
    },
    {
      market: Market.TW,
      indicator: MacroIndicator.ConsumerPrices,
      date: "2026-11-05",
      timing: EventTiming.Set,
      period: "2026-10",
    },
    {
      market: Market.TW,
      indicator: MacroIndicator.Gdp,
      date: "2026-11-30",
      timing: EventTiming.Deadline,
      period: "2026-Q3",
    },
    {
      market: Market.TW,
      indicator: MacroIndicator.EconomicForecast,
      date: "2026-11-30",
      timing: EventTiming.Deadline,
      period: "2027",
    },
  ]);
  expect(sent.map((url) => Object.fromEntries(url.searchParams))).toEqual(
    ["4527", "A07000000D", "A13000000G", "A41000000G"].map((agency) => ({
      n: "3717",
      Dept: agency,
      page: "1",
      PageSize: "50",
    }))
  );
});

test("months run on from the calendar's first across the year's end, and a day a month lacks is dropped", async () => {
  const { statGovTw } = fakePortal({
    A07000000D: {
      body: page(
        [
          release("107", "海關進出口貿易初步統計", [
            [{ date: "31", notice: "(11510)" }],
            [{ date: "9", notice: "(11511)" }],
            [{ date: "8", notice: "(11512)" }],
          ]),
          { ContentUrl: 107, timedatas: "unset" },
        ],
        115,
        11
      ),
    },
  });

  expect(await statGovTw.releases(Market.TW, "2026-01-01")).toEqual([
    {
      market: Market.TW,
      indicator: MacroIndicator.Trade,
      date: "2026-12-09",
      timing: EventTiming.Set,
      period: "2026-11",
    },
    {
      market: Market.TW,
      indicator: MacroIndicator.Trade,
      date: "2027-01-08",
      timing: EventTiming.Set,
      period: "2026-12",
    },
  ]);
});

test("outside Taiwan there is no schedule, and it costs no request", async () => {
  const { sent, statGovTw } = fakePortal({});

  expect(await statGovTw.releases(Market.US, "2026-10-01")).toEqual([]);
  expect(sent).toEqual([]);
});

test("a failure names the portal and its status", async () => {
  const { statGovTw } = fakePortal({ A13000000G: { status: 503, body: "" } });

  await expect(statGovTw.releases(Market.TW, "2026-10-01")).rejects.toThrow(
    "stat.gov.tw answered 503"
  );
});

test("a page without its calendar fails rather than reading as no releases", async () => {
  const { statGovTw } = fakePortal({
    "4527": { body: "<html>Maintenance</html>" },
  });

  await expect(statGovTw.releases(Market.TW, "2026-10-01")).rejects.toThrow(
    "no calendar"
  );
});
