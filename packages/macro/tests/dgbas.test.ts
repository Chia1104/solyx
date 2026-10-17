import { expect, test, vi } from "vite-plus/test";

import { MacroFigure, MacroIndicator, MacroUnit } from "@solyx/core/macro";
import { Market } from "@solyx/core/market";

import { createDgbas } from "../src/dgbas.ts";

type Dimension = [id: string, name: string][];

/** A table's answer as the database serves it: its dimensions' items, its periods and each series' values by period. */
const table = (
  dimensions: Dimension[],
  periods: string[],
  series: Record<string, number[]>
) => ({
  meta: { id: "test", sender: { id: "dgbas" } },
  data: {
    dataSets: [
      {
        action: "Information",
        series: Object.fromEntries(
          Object.entries(series).map(([key, values]) => [
            key,
            {
              observations: Object.fromEntries(
                values.map((value, index) => [String(index), [value]])
              ),
            },
          ])
        ),
      },
    ],
    structure: {
      name: "Table",
      dimensions: {
        series: dimensions.map((values, keyPosition) => ({
          keyPosition,
          id: keyPosition === 0 ? "fldid" : "code1",
          values: values.map(([id, name]) => ({ id, name })),
        })),
        observation: [{ id: "ym", values: periods.map((id) => ({ id })) }],
      },
    },
  },
});

const MONTHS = ["2025-M8", "2025-M9", "2026-M8", "2026-M9", "2026-M10"];

/** Every table the reader follows, answered for five periods of which the last is not out. */
const TABLES = {
  A030601015: table(
    [
      [
        ["1", "消費者物價總指數_未經季節調整"],
        ["3", "消費者物價總指數(不含蔬果及能源)【即核心物價】_未經季節調整"],
      ],
    ],
    MONTHS,
    { "0": [100, 100.5, 102, 102.5, 0], "1": [100, 100, 101, 0, 0] }
  ),
  A018101010: table(
    [[["3", "經濟成長率(%)"]]],
    ["2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"],
    { "0": [3.1, 0, 2.4, 2.9, 0, 0] }
  ),
  A081201010: table(
    [
      [["2", "USD(百萬美元)"]],
      [
        ["1", "出口"],
        ["2", "進口"],
      ],
    ],
    MONTHS,
    {
      "0:0": [40000, 41000, 50000, 52000, 0],
      "0:1": [30000, 31000, 36000, 38000, 0],
    }
  ),
  A050105010: table([[["2", "美金計價(百萬美元)"]], [["1", "合計"]]], MONTHS, {
    "0:0": [50000, 52000, 60000, 0, 0],
  }),
  A050104010: table([[["1", "總指數"]]], MONTHS, {
    "0": [100, 101, 110, 0, 0],
  }),
  A120101010: table([[["5", "景氣對策信號(分)"]]], MONTHS, {
    "0": [30, 31, 41, 0, 0],
  }),
};

/** Answers each table's query with what is given for its code. */
function fakeDatabase(
  answers: Record<string, ReturnType<typeof table> | Response> = TABLES
) {
  const sent: string[] = [];

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const { url } = new Request(input, init);

    sent.push(url);

    const answer = answers[/sdmx\/(A\d+)\//.exec(url)?.[1] ?? ""];

    return answer instanceof Response ? answer : Response.json(answer);
  };

  // 2026-10-12 10:00 in Taipei.
  const now = () => new Date("2026-10-12T02:00:00Z");

  return { sent, dgbas: createDgbas({ fetch, now }) };
}

test("reads each followed figure from its table through the newest period out, an indicator's headline first", async () => {
  const { sent, dgbas } = fakeDatabase();

  const series = await dgbas.series(Market.TW, "2025-08");

  expect(
    series.map(({ indicator, figure, unit, observations }) => [
      indicator,
      figure,
      unit,
      observations.at(-1),
    ])
  ).toEqual([
    [
      MacroIndicator.ConsumerPrices,
      MacroFigure.ConsumerPrices,
      MacroUnit.Index,
      { period: "2026-09", value: 102.5 },
    ],
    [
      MacroIndicator.ConsumerPrices,
      MacroFigure.CoreConsumerPrices,
      MacroUnit.Index,
      { period: "2026-08", value: 101 },
    ],
    [
      MacroIndicator.AdvanceGdp,
      MacroFigure.GdpGrowth,
      MacroUnit.Percent,
      { period: "2026-Q2", value: 2.9 },
    ],
    [
      MacroIndicator.Trade,
      MacroFigure.Exports,
      MacroUnit.UsdMillions,
      { period: "2026-09", value: 52000 },
    ],
    [
      MacroIndicator.Trade,
      MacroFigure.Imports,
      MacroUnit.UsdMillions,
      { period: "2026-09", value: 38000 },
    ],
    [
      MacroIndicator.ExportOrders,
      MacroFigure.ExportOrders,
      MacroUnit.UsdMillions,
      { period: "2026-08", value: 60000 },
    ],
    [
      MacroIndicator.IndustrialProduction,
      MacroFigure.IndustrialProduction,
      MacroUnit.Index,
      { period: "2026-08", value: 110 },
    ],
    [
      MacroIndicator.BusinessSignal,
      MacroFigure.BusinessSignal,
      MacroUnit.Points,
      { period: "2026-08", value: 41 },
    ],
  ]);
  expect(series[0].observations.map(({ period }) => period)).toEqual([
    "2025-08",
    "2025-09",
    "2026-08",
    "2026-09",
  ]);
  // A zero before the newest period out is a figure, as a quarter without growth is.
  expect(series[2].observations).toEqual([
    { period: "2025-Q3", value: 3.1 },
    { period: "2025-Q4", value: 0 },
    { period: "2026-Q1", value: 2.4 },
    { period: "2026-Q2", value: 2.9 },
  ]);
  expect(sent.toSorted()).toEqual(
    [
      "A018101010/3...Q&startTime=2025-Q3&endTime=2026-Q4",
      "A030601015/1+3...M&startTime=2025-M8&endTime=2026-M10",
      "A050104010/1...M&startTime=2025-M8&endTime=2026-M10",
      "A050105010/2.1..M&startTime=2025-M8&endTime=2026-M10",
      "A081201010/2.1+2..M&startTime=2025-M8&endTime=2026-M10",
      "A120101010/5...M&startTime=2025-M8&endTime=2026-M10",
    ].map(
      (query) =>
        `https://nstatdb.dgbas.gov.tw/dgbasAll/webMain.aspx?sdmx/${query}`
    )
  );
});

test("fails when a table names an item another way, rather than read another figure as it", async () => {
  const { dgbas } = fakeDatabase({
    ...TABLES,
    A081201010: table(
      [
        [["2", "NTD(百萬元)"]],
        [
          ["1", "出口"],
          ["2", "進口"],
        ],
      ],
      MONTHS,
      { "0:0": [1, 2, 3, 4, 0], "0:1": [1, 2, 3, 4, 0] }
    ),
  });

  await expect(dgbas.series(Market.TW, "2025-08")).rejects.toThrow(
    "DGBAS: A081201010 no longer lists USD(百萬美元) as item 2"
  );
});

test("fails when a query is answered with the table's web page instead of its figures", async () => {
  const { dgbas } = fakeDatabase({
    ...TABLES,
    A050104010: new Response("<!DOCTYPE html><title>工業生產指數</title>", {
      headers: { "content-type": "text/html" },
    }),
  });

  await expect(dgbas.series(Market.TW, "2025-08")).rejects.toThrow(
    "DGBAS: A050104010 did not answer its figures"
  );
});

test("fails when a figure has nothing out over the periods asked for", async () => {
  const { dgbas } = fakeDatabase({
    ...TABLES,
    A120101010: table([[["5", "景氣對策信號(分)"]]], MONTHS, {
      "0": [0, 0, 0, 0, 0],
    }),
  });

  await expect(dgbas.series(Market.TW, "2025-08")).rejects.toThrow(
    "DGBAS: A120101010 has nothing out for 景氣對策信號(分) since 2025-08"
  );
});

test("asks again when the database leaves a request hanging", async () => {
  vi.useFakeTimers();

  const answers = new Map(Object.entries(TABLES));
  const sent: string[] = [];

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const code = /sdmx\/(A\d+)\//.exec(request.url)?.[1] ?? "";

    sent.push(code);

    if (code === "A081201010" && !sent.slice(0, -1).includes(code)) {
      return new Promise<Response>((_, reject) => {
        request.signal.addEventListener("abort", () =>
          reject(request.signal.reason)
        );
      });
    }

    return Response.json(answers.get(code));
  };

  const dgbas = createDgbas({
    fetch,
    now: () => new Date("2026-10-12T02:00:00Z"),
  });

  try {
    const series = dgbas.series(Market.TW, "2025-08");

    await vi.advanceTimersByTimeAsync(10_000);

    expect(
      (await series)
        .find(({ figure }) => figure === MacroFigure.Exports)
        ?.observations.at(-1)
    ).toEqual({ period: "2026-09", value: 52000 });
    expect(sent.filter((code) => code === "A081201010")).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});

test("a failure names the database and the status it answered", async () => {
  const { dgbas } = fakeDatabase({
    ...TABLES,
    A030601015: new Response("", { status: 404 }),
  });

  await expect(dgbas.series(Market.TW, "2025-08")).rejects.toThrow(
    "DGBAS answered 404"
  );
});

test("outside Taiwan there are no figures, and it costs no request", async () => {
  const { sent, dgbas } = fakeDatabase();

  expect(await dgbas.series(Market.US, "2025-08")).toEqual([]);
  expect(sent).toEqual([]);
});
