import { expect, test } from "vite-plus/test";

import { EventTiming } from "@solyx/core/calendar";
import { MacroFigure, MacroIndicator, MacroUnit } from "@solyx/core/macro";
import { Market } from "@solyx/core/market";
import { createLongbridge } from "@solyx/longbridge/client";

import { createLongbridgeMacro } from "../src/longbridge.ts";

interface Release {
  observed: string;
  published: string;
  actual: string;
  estimated: string;
}

/** A series' points as Longbridge answers them, newest first. */
const history = (name: string, releases: Release[]) => ({
  indicator: {
    indicator_id: 1,
    indicator_name: name,
    unit: "Percent",
    description: "",
    market: "US",
    frequence: "month",
    importance: 3,
    indicator_data: releases.map(
      ({ observed, published, actual, estimated }) => ({
        actual_data: actual,
        previous_data: "",
        estimated_data: estimated,
        published_time: published,
        observation_date: observed,
      })
    ),
  },
  total: releases.length,
});

const CPI = "United States, CPI - All Urban Samples: All Items, Chg Y/Y";

const CORE_CPI =
  "United States, CPI, All items less food and energy, Chg Y/Y, Price Index";

const FED = "United States, Policy Rates, Fed Funds Target Rate";

const GDP = "United States, GDP, Total-adv, Chg P/P";

const CLAIMS = "United States, Jobless Claims, National, Initial";

/** The series these tests give points, by Longbridge's code; every other followed one has a point that is out. */
const ANSWERS = new Map([
  [
    "30771871",
    history(CPI, [
      {
        observed: "2026-10-01",
        published: "2026-11-10T13:30:00Z",
        actual: "",
        estimated: "3.8",
      },
      {
        observed: "2026-09-01",
        published: "2026-10-14T12:30:00Z",
        actual: "3.7",
        estimated: "3.6",
      },
      {
        observed: "2026-08-01",
        published: "2026-09-11T12:30:00",
        actual: "3.4",
        estimated: "",
      },
    ]),
  ],
  [
    "30771867",
    history(CORE_CPI, [
      {
        observed: "2026-10-01",
        published: "2026-11-10T13:30:00Z",
        actual: "",
        estimated: "",
      },
      {
        observed: "2026-09-01",
        published: "2026-10-14T12:30:00Z",
        actual: "3.1",
        estimated: "3.1",
      },
    ]),
  ],
  [
    "30771885",
    history(FED, [
      {
        observed: "2026-10-29",
        published: "2026-10-28T18:00:00Z",
        actual: "3.875",
        estimated: "3.875",
      },
    ]),
  ],
  [
    "30771685",
    history(GDP, [
      {
        observed: "2026-07-01",
        published: "2026-10-29T12:30:00Z",
        actual: "",
        estimated: "3.2",
      },
      {
        observed: "2026-04-01",
        published: "2026-07-30T12:30:00Z",
        actual: "1.5",
        estimated: "2.1",
      },
    ]),
  ],
  [
    "30771888",
    history(CLAIMS, [
      {
        observed: "2026-10-24",
        published: "2026-10-29T12:30:00Z",
        actual: "",
        estimated: "199",
      },
      {
        observed: "2026-10-17",
        published: "2026-10-22T12:30:00Z",
        actual: "194",
        estimated: "200",
      },
    ]),
  ],
]);

const FOLLOWED_NAMES = new Map([
  ["30771701", "United States, Personal Consumption Expenditure, Chg Y/Y"],
  [
    "30771724",
    "United States, Personal Consumption Expenditure, Personal consumption expenditures less food and energy, Chg Y/Y",
  ],
  [
    "30771890",
    "United States, Employment, Nonfarm payroll, total, Absolute change",
  ],
  ["30771865", "United States, Unemployment, Rate"],
  ["30771722", "United States, Average Earnings YY, Chg Y/Y"],
  [
    "30771869",
    "United States, Retail Sales, Total including food services, Chg P/P",
  ],
  ["30771942", "United States, ISM Manufacturing, PMI total"],
  ["30771978", "United States, ISM Non-manufacturing, NMI/PMI"],
  ["30771924", "United States, Producer Prices, Final demand, Chg Y/Y"],
  [
    "30772023",
    "United States, University of Michigan, Total-prelim, Volume Index",
  ],
]);

/** Answers each series' path in Longbridge's envelope, every series not in `answers` with one point out in August, and records what was asked. */
function fakeLongbridge(answers = ANSWERS) {
  const asked: { path: string; params: URLSearchParams; headers: Headers }[] =
    [];

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const code = url.pathname.split("/").at(-1) ?? "";

    asked.push({
      path: url.pathname,
      params: url.searchParams,
      headers: request.headers,
    });

    const data =
      answers.get(code) ??
      history(FOLLOWED_NAMES.get(code) ?? "", [
        {
          observed: "2026-08-01",
          published: "2026-09-04T12:30:00Z",
          actual: "50",
          estimated: "",
        },
      ]);

    return Response.json({ code: 0, message: "success", data });
  };

  return {
    asked,
    macro: createLongbridgeMacro({
      api: createLongbridge({ accessToken: async () => "hk_access", fetch }),
    }),
  };
}

test("reads each followed series from the month asked for, in English, oldest first, with what was expected of each period and of the next", async () => {
  const { asked, macro } = fakeLongbridge();

  const series = await macro.series(Market.US, "2024-08");

  expect(asked).toHaveLength(15);
  expect(asked[0]?.path).toBe("/v2/quote/macrodata/30771885");
  expect(Object.fromEntries(asked[0]?.params ?? [])).toEqual({
    start_date: "2024-08-01",
    limit: "100",
    sort: "desc",
  });
  expect(asked[0]?.headers.get("accept-language")).toBe("en");

  const figure = (wanted: MacroFigure) =>
    series.find((each) => each.figure === wanted);

  expect(figure(MacroFigure.ConsumerPrices)).toEqual({
    market: Market.US,
    indicator: MacroIndicator.ConsumerPrices,
    figure: MacroFigure.ConsumerPrices,
    unit: MacroUnit.GrowthOnYear,
    observations: [
      { period: "2026-08", value: 3.4, forecast: null },
      { period: "2026-09", value: 3.7, forecast: 3.6 },
    ],
    expected: { period: "2026-10", forecast: 3.8 },
  });
  expect(figure(MacroFigure.CoreConsumerPrices)?.expected).toBeNull();
  expect(figure(MacroFigure.PolicyRate)?.observations).toEqual([
    { period: "2026-10-28", value: 3.875, forecast: 3.875 },
  ]);
  expect(figure(MacroFigure.GdpAnnualized)).toMatchObject({
    observations: [{ period: "2026-Q2", value: 1.5, forecast: 2.1 }],
    expected: { period: "2026-Q3", forecast: 3.2 },
  });
  expect(figure(MacroFigure.InitialClaims)).toMatchObject({
    unit: MacroUnit.Thousands,
    observations: [{ period: "2026-10-17", value: 194, forecast: 200 }],
    expected: { period: "2026-10-24", forecast: 199 },
  });
});

test("a code Longbridge now names another series fails the read rather than passing that one off as the one followed", async () => {
  const { macro } = fakeLongbridge(
    new Map([
      ...ANSWERS,
      ["30771871", history("United States, CPI, All items, Chg P/P", [])],
    ])
  );

  await expect(macro.series(Market.US, "2024-08")).rejects.toThrow(
    `Longbridge no longer names series 30771871 ${CPI}`
  );
});

test("an indicator's figures released together are one release, on New York's day and clock, named by its headline's period", async () => {
  const { macro } = fakeLongbridge();

  const releases = await macro.releases(Market.US, "2026-10-22");

  expect(releases).toEqual([
    {
      market: Market.US,
      indicator: MacroIndicator.JoblessClaims,
      date: "2026-10-22",
      time: "08:30",
      timing: EventTiming.Set,
      period: "2026-10-17",
      page: null,
    },
    {
      market: Market.US,
      indicator: MacroIndicator.PolicyRate,
      date: "2026-10-28",
      time: "14:00",
      timing: EventTiming.Set,
      period: "2026-10-28",
      page: null,
    },
    {
      market: Market.US,
      indicator: MacroIndicator.AdvanceGdp,
      date: "2026-10-29",
      time: "08:30",
      timing: EventTiming.Set,
      period: "2026-Q3",
      page: null,
    },
    {
      market: Market.US,
      indicator: MacroIndicator.JoblessClaims,
      date: "2026-10-29",
      time: "08:30",
      timing: EventTiming.Set,
      period: "2026-10-24",
      page: null,
    },
    {
      market: Market.US,
      indicator: MacroIndicator.ConsumerPrices,
      date: "2026-11-10",
      time: "08:30",
      timing: EventTiming.Set,
      period: "2026-10",
      page: null,
    },
  ]);
});

test("another market is none of its business and costs no request", async () => {
  const { asked, macro } = fakeLongbridge();

  await expect(macro.series(Market.TW, "2024-08")).resolves.toEqual([]);
  await expect(macro.releases(Market.TW, "2026-10-22")).resolves.toEqual([]);
  expect(asked).toHaveLength(0);
});
