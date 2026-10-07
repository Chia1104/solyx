import type { Context, JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { contentText } from "@earendil-works/pi-ai";
import type {
  ToolExecutionApi,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import { expect, test } from "vite-plus/test";

import type { Candle } from "@solyx/core/candles";
import { MagiUnit, MagiVote, resolveCouncil } from "@solyx/core/council";
import type { Council } from "@solyx/core/council";
import { ForecastDirection } from "@solyx/core/forecast";
import type { Forecast } from "@solyx/core/forecast";
import type { QuarterStatement } from "@solyx/core/fundamentals";
import { InstrumentKind, Market, symbolKey } from "@solyx/core/market";
import { ReportSection, ReportStance } from "@solyx/core/report";
import type { Report } from "@solyx/core/report";
import { ResearchDesk } from "@solyx/core/research";
import type { ResearchStore } from "@solyx/core/research";
import { twFilingDeadline } from "@solyx/core/rules/tw";

import { createResearch } from "../src/research.ts";
import { AgentToolName } from "../src/wire.ts";

type ToolArguments = Parameters<ToolRegistration["execute"]>[0];

const TSMC = { market: Market.TW, symbol: "2330" };

const AT_ANCHOR = Date.parse("2026-09-29T14:00:00+08:00");

const AFTER_HORIZON = Date.parse("2026-10-01T14:00:00+08:00");

function bar(date: string, close: number): Candle {
  return {
    time: Date.parse(`${date}T00:00:00+08:00`) / 1000,
    open: close,
    high: close + 5,
    low: close - 5,
    close,
    volume: 1000,
  };
}

const ANCHOR_BAR = bar("2026-09-29", 1000);

const LATER_BARS = [bar("2026-09-30", 1010), bar("2026-10-01", 1045)];

function quarter(periodEnd: string, revenue: number, eps: number) {
  return {
    periodEnd,
    knownFrom: twFilingDeadline(periodEnd),
    revenue: revenue * 1e6,
    grossProfit: revenue * 0.6e6,
    operatingIncome: revenue * 0.5e6,
    netIncome: revenue * 0.4e6,
    eps,
  } satisfies QuarterStatement;
}

const QUARTERS = [
  quarter("2025-03-31", 800, 10),
  quarter("2025-06-30", 900, 12),
  quarter("2025-09-30", 1000, 14),
  quarter("2025-12-31", 1100, 14),
  quarter("2026-03-31", 1200, 20),
  quarter("2026-06-30", 1350, 24),
];

const MONTHS = [
  { month: "2025-08", revenue: 300e6 },
  { month: "2026-07", revenue: 400e6 },
  { month: "2026-08", revenue: 450e6 },
];

const REPORT = {
  symbol: TSMC,
  stance: ReportStance.Bullish,
  thesis: "Advanced nodes stay sold out.",
  drivers: [
    {
      point: "Demand is still strong.",
      text: "August revenue rose 53% on the year.",
      source: "TWSE monthly revenue, 2026-08",
      quote: "去年同月增減 53.32%",
    },
  ],
  falsifiers: ["Monthly revenue falls year on year two months running."],
  sections: { [ReportSection.Business]: "Foundry for leading-edge logic." },
};

const FORECAST = {
  instrument: { ...TSMC, kind: InstrumentKind.Stock },
  horizon: 2,
  direction: ForecastDirection.Long,
  plan: { entry: 1000, stop: 980, target: 1040 },
  scenarios: [
    {
      label: "Down",
      probability: 40,
      low: null,
      high: 1000,
      path: [{ session: 2, price: 980 }],
    },
    {
      label: "Up",
      probability: 60,
      low: 1000,
      high: null,
      path: [{ session: 2, price: 1030 }],
    },
  ],
  rationale: "Holds the 20-day average, as_of 2026-09-29.",
};

// The SQLite store is tested in @solyx/db.
function fakeStore(): ResearchStore {
  const reports: Report[] = [];
  const forecasts = new Map<string, Forecast>();

  return {
    report: (symbol) =>
      reports.findLast(
        (report) => symbolKey(report.symbol) === symbolKey(symbol)
      ),
    addReport: (report) => void reports.push(report),
    forecast: (id) => forecasts.get(id),
    forecasts: (symbol) =>
      [...forecasts.values()].filter(
        (forecast) =>
          !symbol || symbolKey(forecast.instrument) === symbolKey(symbol)
      ),
    addForecast: (forecast) => void forecasts.set(forecast.id, forecast),
    settle(id, outcome) {
      const forecast = forecasts.get(id);

      if (forecast) forecasts.set(id, { ...forecast, outcome });
    },
  };
}

/** A call's api as pi-durable hands it to a tool, keeping the call's memo between runs. */
function callApi(callId: string): ToolExecutionApi {
  const memos = new Map<string, JsonValue>();

  // SAFETY: the research tools read only the call's memo.
  return {
    conversationId: 7,
    callId,
    // Read alone when only a name and the context are passed, as the ballot box does.
    async memo(name: string, ...rest: [Context] | [JsonValue, Context]) {
      if (rest.length === 2 && !memos.has(name)) memos.set(name, rest[0]);

      return memos.get(name);
    },
  } as ToolExecutionApi;
}

function setup(council?: Council) {
  const clock = { now: AT_ANCHOR };
  const motions: string[] = [];
  const bars = { daily: [ANCHOR_BAR] };
  const filed = { quarters: QUARTERS, months: MONTHS };
  const store = fakeStore();
  const marketData = { candles: async () => bars.daily };

  const fundamentals = {
    statements: async () => filed.quarters,
    monthlyRevenue: async () => filed.months,
  };

  const desk = new ResearchDesk({
    store,
    marketData,
    fundamentals,
    now: () => clock.now,
  });

  const { tools = [] } = createResearch({
    desk,
    fundamentals,
    marketData,
    magi: async () =>
      council &&
      (async (motion) => {
        motions.push(motion);

        return council;
      }),
    now: () => new Date(clock.now),
  });

  async function run(
    name: AgentToolName,
    params: ToolArguments,
    api = callApi("call-1")
  ) {
    const tool = tools.find((candidate) => candidate.name === name);

    if (!tool) throw new Error(`No tool ${name}`);

    const result = await tool.execute(params, api, BACKGROUND_CONTEXT);

    return { text: contentText(result.content ?? []), details: result.details };
  }

  return { run, store, clock, bars, filed, motions };
}

test("a listing without research says so", async () => {
  const { run } = setup();

  const { text } = await run(AgentToolName.GetResearch, { symbol: TSMC });

  expect(text).toContain("TW 2330 has no report yet.");
  expect(text).toContain("No forecasts yet.");
  expect(text).toContain(
    "Record, every listing: 0 forecasts, none settled yet."
  );
});

test("a revision is kept and read back with its sources and each part's age", async () => {
  const { run } = setup();

  expect(await run(AgentToolName.ReviseReport, REPORT)).toEqual({
    text: "Kept revision 1 of the TW 2330 report.",
    details: { symbol: TSMC, revision: 1 },
  });

  const { text } = await run(AgentToolName.GetResearch, { symbol: TSMC });

  expect(text).toContain("Report revision 1, revised 2026-09-29: bullish");
  expect(text).toContain(
    '- Demand is still strong.\n  rests on: August revenue rose 53% on the year. [TWSE monthly revenue, 2026-08: "去年同月增減 53.32%"]'
  );
  expect(text).toContain("## business, written 2026-09-29");
});

test("a refused revision tells the model what is missing", async () => {
  const { run } = setup();

  await expect(
    run(AgentToolName.ReviseReport, { symbol: TSMC, thesis: "Sold out." })
  ).rejects.toThrow(
    "The report was not kept.\nThe listing has no report yet, so this one needs a stance."
  );
});

test("a forecast is kept under the report, and the call's second run finds it", async () => {
  const { run, store } = setup();
  const api = callApi("call-2");

  await run(AgentToolName.ReviseReport, REPORT);

  const first = await run(AgentToolName.SubmitForecast, FORECAST, api);
  const [kept] = store.forecasts();

  expect(first.text).toContain(
    "long over 2 sessions from 2026-09-29 at 1000, under report revision 1"
  );
  expect(first.text).toContain(
    "scenarios: Down (below 1000) 40%, Up (1000 and above) 60%"
  );
  expect(first.details).toEqual({ symbol: TSMC, forecastId: kept.id });
  expect(kept).toMatchObject({ claims: [], contrary: null });

  expect(await run(AgentToolName.SubmitForecast, FORECAST, api)).toEqual(first);
  expect(store.forecasts()).toHaveLength(1);
});

test("a refused forecast names every fix and keeps nothing", async () => {
  const { run, store } = setup();

  await expect(
    run(AgentToolName.SubmitForecast, {
      ...FORECAST,
      plan: { entry: 1002, stop: 980, target: 1040 },
      scenarios: [
        { ...FORECAST.scenarios[0], probability: 30 },
        {
          ...FORECAST.scenarios[1],
          path: [{ session: 1, price: 1030 }],
        },
      ],
    })
  ).rejects.toThrow(
    [
      "The forecast was not kept. Fix these and submit again.",
      "The listing has no report. Write one with revise_report first.",
      "The probabilities add up to 90, not 100.",
      'The path of "Up" must list sessions in rising order and end at session 2, the horizon.',
      "The plan's price 1002 is not on the 5 tick.",
    ].join("\n")
  );
  expect(store.forecasts()).toEqual([]);
});

test("a neutral forecast needs no plan", async () => {
  const { run, store } = setup();

  await run(AgentToolName.ReviseReport, REPORT);
  await run(AgentToolName.SubmitForecast, {
    ...FORECAST,
    direction: ForecastDirection.Neutral,
    plan: undefined,
  });

  expect(store.forecasts()[0].plan).toBe(null);
});

test("research shows how a forecast came out and the record it leaves", async () => {
  const { run, clock, bars } = setup();

  await run(AgentToolName.ReviseReport, REPORT);
  await run(AgentToolName.SubmitForecast, FORECAST);

  expect(
    (await run(AgentToolName.GetResearch, { symbol: TSMC })).text
  ).toContain("outcome: open until its horizon's session closes");

  clock.now = AFTER_HORIZON;
  bars.daily = [ANCHOR_BAR, ...LATER_BARS];

  const { text } = await run(AgentToolName.GetResearch, { symbol: TSMC });

  expect(text).toContain(
    'outcome: closed 1045 on 2026-10-01, in "Up", Brier 0.32; plan hit-target at +2.00R'
  );
  expect(text).toContain(
    "Record, this listing: 1 forecasts, 1 settled, mean Brier 0.32"
  );
  expect(text).toContain("; mean +2.00R of those entered");
  expect(text).toContain(
    "scenarios by the probability you gave: 40-60% held 0 of 1; 60-80% held 1 of 1"
  );
});

test("fundamentals show each quarter alone with its growth, and what the shares trade at", async () => {
  const { run } = setup();

  const { text } = await run(AgentToolName.GetFundamentals, { symbol: TSMC });

  expect(text).toContain(
    "TW 2330 fundamentals as filed, as_of 2026-09-29; amounts in TWD millions"
  );
  expect(text).toContain(
    "2026-06-30,1350,+50.0%,+12.5%,60.0%,50.0%,40.0%,24,+100.0%,72"
  );
  expect(text).toContain("2025-03-31,800,n/a,n/a,60.0%,50.0%,40.0%,10,n/a,n/a");
  // The anchor's close of 1000 over the 72 earned in the four quarters through June.
  expect(text).toContain(
    "Price to earnings: 13.89, the close of 1000 in the week of 2026-09-29 over trailing EPS 72 (four quarters through 2026-06-30)."
  );
  expect(text).toContain("low 13.89, median 13.89, high 13.89");
  expect(text).toContain("2026-08,450,+50.0%,+12.5%");
});

test("a listing without filings says so", async () => {
  const { run, filed } = setup();

  filed.quarters = [];
  filed.months = [];

  expect(
    (await run(AgentToolName.GetFundamentals, { symbol: TSMC })).text
  ).toContain("No fundamentals for TW 2330");
});

test("a report older than the newest quarter is flagged and refuses a forecast", async () => {
  const { run, filed } = setup();

  await run(AgentToolName.ReviseReport, REPORT);
  filed.quarters = [...QUARTERS, quarter("2026-09-30", 1500, 28)];

  expect(
    (await run(AgentToolName.GetResearch, { symbol: TSMC })).text
  ).toContain(
    "The report was revised before the quarter ending 2026-09-30 was out."
  );
  await expect(run(AgentToolName.SubmitForecast, FORECAST)).rejects.toThrow(
    "Read it with get_fundamentals, revise the report with revise_report, then submit again."
  );
});

const votes = (...cast: (MagiVote | null)[]) =>
  resolveCouncil(
    Object.values(MagiUnit).map((unit, index) => ({
      unit,
      vote: cast[index],
      reason: `${unit} has its reason.`,
      model: "faux",
    }))
  );

test("under the MAGI a carried forecast is kept with its votes, which the model is told", async () => {
  const council = votes(MagiVote.Approve, MagiVote.Reject, MagiVote.Approve);
  const { run, store, motions } = setup(council);

  await run(AgentToolName.ReviseReport, REPORT);

  const { text, details } = await run(AgentToolName.SubmitForecast, FORECAST);
  const [kept] = store.forecasts();

  expect(kept.council).toEqual(council);
  expect(details).toEqual({ symbol: TSMC, forecastId: kept.id });
  expect(text).toContain("The MAGI carried the motion, 2 to 1.");
  expect(text).toContain("- BALTHASAR-2 reject: balthasar has its reason.");
  expect(motions[0]).toContain(
    "put on record a long forecast for TW:2330 over 2 sessions"
  );
});

test("under the MAGI a rejected forecast is not kept, and its votes come back without a fault", async () => {
  const council = votes(MagiVote.Reject, MagiVote.Reject, MagiVote.Approve);
  const { run, store } = setup(council);

  await run(AgentToolName.ReviseReport, REPORT);

  const { text, details } = await run(AgentToolName.SubmitForecast, FORECAST);

  expect(store.forecasts()).toEqual([]);
  expect(details).toEqual({ symbol: TSMC, council });
  expect(text).toContain("The MAGI rejected the motion, 1 to 2.");
  expect(text).toContain("You may put one revised motion");
});

test("under the MAGI a forecast the missing votes could have carried is undecided, not rejected", async () => {
  const { run, store } = setup(votes(MagiVote.Approve, null, MagiVote.Reject));

  await run(AgentToolName.ReviseReport, REPORT);

  const { text } = await run(AgentToolName.SubmitForecast, FORECAST);

  expect(store.forecasts()).toEqual([]);
  expect(text).toContain("The MAGI could not decide the motion, 1 to 1.");
  expect(text).toContain("Tell the user which units gave no vote and why");
  expect(text).not.toContain("revised motion");
});

test("no vote is held on a forecast the checks refuse", async () => {
  const { run, motions } = setup(
    votes(MagiVote.Approve, MagiVote.Approve, MagiVote.Approve)
  );

  await expect(run(AgentToolName.SubmitForecast, FORECAST)).rejects.toThrow(
    "The listing has no report."
  );
  expect(motions).toEqual([]);
});
