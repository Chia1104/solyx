import type { Context, JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { contentText } from "@earendil-works/pi-ai";
import type {
  ToolExecutionApi,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import { expect, test } from "vite-plus/test";

import { EventTiming } from "@solyx/core/calendar";
import type { Candle } from "@solyx/core/candles";
import { MagiUnit, MagiVote, resolveCouncil } from "@solyx/core/council";
import type { Council } from "@solyx/core/council";
import { ForecastDirection } from "@solyx/core/forecast";
import type { Forecast } from "@solyx/core/forecast";
import type {
  BalanceSheet,
  CashFlow,
  Dividend,
  FundProfile,
  MonthlyRevenue,
  QuarterStatement,
} from "@solyx/core/fundamentals";
import { InstrumentKind, Market, symbolKey } from "@solyx/core/market";
import { TimePrecision } from "@solyx/core/news";
import { ReportSection, ReportStance } from "@solyx/core/report";
import type { Report } from "@solyx/core/report";
import { ResearchDesk } from "@solyx/core/research";
import type { FalsifierCheck, ResearchStore } from "@solyx/core/research";
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

const SHEETS: BalanceSheet[] = [
  {
    periodEnd: "2026-06-30",
    totalAssets: 1500e6,
    totalLiabilities: 1200e6,
    equity: 300e6,
    cash: 120e6,
    receivables: 570e6,
    inventories: 530e6,
    currentAssets: 1380e6,
    currentLiabilities: 1150e6,
    shortTermBorrowings: 425e6,
    longTermBorrowings: 58e6,
    bondsPayable: null,
  },
];

const FLOWS: CashFlow[] = [
  ["2025-09-30", 400e6, 280e6],
  ["2025-12-31", 700e6, 350e6],
  ["2026-03-31", -140e6, 90e6],
  ["2026-06-30", 600e6, 100e6],
].map(([periodEnd, operating, capitalExpenditure]) => ({
  periodEnd: String(periodEnd),
  operating: Number(operating),
  capitalExpenditure: Number(capitalExpenditure),
  investing: -300e6,
  financing: null,
}));

const DIVIDENDS = [
  {
    period: "115年第1季",
    announced: "2026-09-01",
    cash: 7,
    stock: 0,
    cashExDate: "2026-09-16",
    cashPaidOn: "2026-10-08",
    stockExDate: null,
  },
  {
    period: "115年第2季",
    announced: "2026-09-25",
    cash: 7.5,
    stock: 0,
    cashExDate: null,
    cashPaidOn: null,
    stockExDate: null,
  },
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
  const checks: FalsifierCheck[] = [];

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
    searchReports: () => [],
    searchForecasts: () => [],
    falsifierChecks: (_symbol, revision) =>
      checks.filter((check) => check.revision === revision),
    addFalsifierCheck: (_symbol, check) => void checks.push(check),
    reports: () => reports,
    passageVectors: () => new Map(),
    savePassageVectors: () => undefined,
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

/** What the fake source has on file, which a test may change. */
interface Filed {
  quarters: QuarterStatement[];
  sheets: BalanceSheet[];
  flows: CashFlow[];
  months: MonthlyRevenue[];
  dividends: Dividend[];
  /** Why the months cannot be read, while they cannot. */
  monthsFailure?: string;
  /** What the listing is as a fund, where its exchange lists it as one. */
  fund?: FundProfile;
  /** Why the exchange's funds cannot be read, while they cannot. */
  fundFailure?: string;
}

function setup(council?: Council) {
  const clock = { now: AT_ANCHOR };
  const motions: string[] = [];
  const bars = { daily: [ANCHOR_BAR] };

  const filed: Filed = {
    quarters: QUARTERS,
    sheets: SHEETS,
    flows: FLOWS,
    months: MONTHS,
    dividends: DIVIDENDS,
  };

  const store = fakeStore();
  const marketData = { candles: async () => bars.daily };

  const fundamentals = {
    source: (market: Market) => (market === Market.TW ? "fake" : undefined),
    statements: async () => filed.quarters,
    balanceSheets: async () => filed.sheets,
    cashFlows: async () => filed.flows,
    monthlyRevenue: async () => {
      if (filed.monthsFailure) throw new Error(filed.monthsFailure);

      return filed.months;
    },
    dividends: async () => filed.dividends,
    restrictions: async () => [],
    fund: async () => {
      if (filed.fundFailure) throw new Error(filed.fundFailure);

      return filed.fund ?? null;
    },
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

test("a report's events read back with their sources, one behind today is refused, and one that has passed is marked", async () => {
  const { run, clock } = setup();

  const call = {
    date: "2026-10-16",
    label: "Third-quarter earnings call",
    timing: EventTiming.Deadline,
    source: "Investor relations calendar",
    quote: "3Q26 Earnings Conference: October 16, 2026",
  };

  await expect(
    run(AgentToolName.ReviseReport, {
      ...REPORT,
      events: [{ ...call, date: "2026-09-28" }],
    })
  ).rejects.toThrow(
    'The event "Third-quarter earnings call" is dated 2026-09-28, which has passed.'
  );

  await run(AgentToolName.ReviseReport, { ...REPORT, events: [call] });

  const line =
    '- by 2026-10-16 Third-quarter earnings call [Investor relations calendar: "3Q26 Earnings Conference: October 16, 2026"]';

  expect(
    (await run(AgentToolName.GetResearch, { symbol: TSMC })).text
  ).toContain(`Events:\n${line}`);

  clock.now = Date.parse("2026-10-17T09:00:00+08:00");

  expect(
    (await run(AgentToolName.GetResearch, { symbol: TSMC })).text
  ).toContain(
    "- by 2026-10-16 Third-quarter earnings call (passed: say what came of it and drop it when you next revise) [Investor relations calendar:"
  );
});

test("news a decisions model read as stating a falsifier is listed with the report", async () => {
  const { run, store } = setup();

  await run(AgentToolName.ReviseReport, REPORT);

  const read = (title: string, supported: number): FalsifierCheck => ({
    falsifier: "Gross margin falls below 53%",
    revision: 1,
    source: "news",
    item: {
      id: title,
      title,
      url: "https://news.test/margin",
      site: "news.test",
      published: {
        at: new Date("2026-10-01T02:00:00Z"),
        precision: TimePrecision.Minute,
      },
    },
    support: { model: "jev", supported },
    checkedAt: 0,
  });

  store.addFalsifierCheck(TSMC, read("Gross margin slides to 52%", 0.9));
  store.addFalsifierCheck(TSMC, read("Capex rises", 0.1));

  const { text } = await run(AgentToolName.GetResearch, { symbol: TSMC });

  expect(text).toContain(
    '- "Gross margin falls below 53%": 2026-10-01 10:00 news.test: Gross margin slides to 52% (read as stated, 0.90) https://news.test/margin'
  );
  expect(text).not.toContain("Capex rises");
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
    "TW 2330 fundamentals as filed, from fake, as_of 2026-09-29; amounts in TWD millions"
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
  expect(text).toContain(
    "2026-06-30,120,570,530,1380,1150,1.2,425,58,n/a,1500,1200,80.0%,300"
  );
  expect(text).toContain("2026-06-30,600,100,500,-300,n/a,1560,740");
  expect(text).toContain("2025-09-30,400,280,120,-300,n/a,n/a,n/a");
  expect(text).toContain("2026-08,450,+50.0%,+12.5%");
  expect(text).toContain(
    "2026-09-01,115年第1季,7,2026-09-16,2026-10-08,0,none"
  );
  expect(text).toContain("2026-09-25,115年第2季,7.5,not set,not set,0,none");
  expect(text).toContain(
    "Cash gone ex in the year through 2026-09-29: 7 per share."
  );
});

test("a fund's distributions read without statements or revenue, which it files none of", async () => {
  const { run, filed } = setup();

  filed.quarters = [];
  filed.sheets = [];
  filed.flows = [];
  filed.months = [];
  filed.dividends = [
    {
      period: "115",
      announced: null,
      cash: 1,
      stock: 0,
      cashExDate: "2026-07-21",
      cashPaidOn: "2026-08-10",
      stockExDate: null,
    },
  ];

  const { text } = await run(AgentToolName.GetFundamentals, { symbol: TSMC });

  expect(text).toContain("No quarterly statements on file with fake.");
  expect(text).toContain("No monthly revenue on file with fake.");
  expect(text).toContain("it reads as a fund such as an ETF");
  expect(text).toContain("not given,115,1,2026-07-21,2026-08-10,0,none");
  expect(text).not.toContain("Price to earnings");
});

test("a fund its exchange lists opens with what it is, and is told from a listing with nothing filed", async () => {
  const { run, filed } = setup();

  filed.quarters = [];
  filed.sheets = [];
  filed.flows = [];
  filed.months = [];
  filed.dividends = [];
  filed.fund = {
    name: "範例台灣50單日正向2倍基金",
    category: "槓桿/反向指數股票型基金",
    index: "臺灣50指數",
    benchmark: null,
    foreignHoldings: false,
    manager: null,
    listedOn: "2014-10-31",
    units: 6_759_348_000,
    asOf: "2026-09-28",
  };

  const { text } = await run(AgentToolName.GetFundamentals, { symbol: TSMC });

  expect(text).toContain(
    [
      "A fund, as its exchange lists it, as_of 2026-09-28: 範例台灣50單日正向2倍基金",
      "  kind: 槓桿/反向指數股票型基金",
      "  tracks: 臺灣50指數",
      "  may hold securities listed abroad: no",
      "  listed: 2014-10-31",
      "  units outstanding: 6759348000",
      "No quarterly statements on file with fake.",
    ].join("\n")
  );
  expect(text).toContain("A fund files neither statements nor revenue.");
  expect(text).not.toContain("or a code fake does not know");
});

test("an actively managed fund tracks no index and names what it measures itself against", async () => {
  const { run, filed } = setup();

  filed.fund = {
    name: "範例台股增長主動式ETF基金",
    category: "國內成分證券主動式交易所交易基金(股票)",
    index: null,
    benchmark: "臺灣證券交易所發行量加權股價指數",
    foreignHoldings: null,
    manager: "王小明",
    listedOn: null,
    units: null,
    asOf: "2026-09-28",
  };

  const { text } = await run(AgentToolName.GetFundamentals, { symbol: TSMC });

  expect(text).toContain(
    [
      "  tracks: no index",
      "  measures itself against: 臺灣證券交易所發行量加權股價指數",
      "  manager: 王小明",
      "Quarters, each for the quarter alone, by its last day:",
    ].join("\n")
  );
});

test("the exchange's funds failing to read is said, and the filed figures stay", async () => {
  const { run, filed } = setup();

  filed.fundFailure = "TWSE answered 503";

  const { text } = await run(AgentToolName.GetFundamentals, { symbol: TSMC });

  expect(text).toContain(
    "Whether its exchange lists it as a fund could not be read: TWSE answered 503"
  );
  expect(text).toContain("Quarters, each for the quarter alone");
});

test("a listing with nothing on file says so of each part", async () => {
  const { run, filed } = setup();

  filed.quarters = [];
  filed.sheets = [];
  filed.flows = [];
  filed.months = [];
  filed.dividends = [];

  const { text } = await run(AgentToolName.GetFundamentals, { symbol: TSMC });

  expect(text).toContain("No quarterly statements on file with fake.");
  expect(text).toContain("No distributions on file with fake.");
  expect(text).toContain("or a code fake does not know");
});

test("a market no source covers is told from a listing with nothing on file", async () => {
  const { run } = setup();

  expect(
    (
      await run(AgentToolName.GetFundamentals, {
        symbol: { market: Market.US, symbol: "AAPL" },
      })
    ).text
  ).toBe(
    "No source covers US fundamentals yet, so US AAPL has none to read. That says nothing of what it files."
  );
});

test("a part that cannot be read says why and leaves the others to read", async () => {
  const { run, filed } = setup();

  filed.monthsFailure = "FinMind answered 402: Requests reach the upper limit.";

  const { text } = await run(AgentToolName.GetFundamentals, { symbol: TSMC });

  expect(text).toContain(
    "Monthly revenue could not be read: FinMind answered 402: Requests reach the upper limit."
  );
  expect(text).toContain("Quarters, each for the quarter alone");
  expect(text).toContain("Cash gone ex in the year through 2026-09-29");
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
