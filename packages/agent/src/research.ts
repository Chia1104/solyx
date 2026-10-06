import { defineExtension } from "@earendil-works/pi-durable";
import type { Extension } from "@earendil-works/pi-durable";
import { median, takeRight } from "es-toolkit";
import * as z from "zod";

import { Interval, candleDate } from "@solyx/core/candles";
import {
  ForecastViolationCode,
  MAX_HORIZON,
  forecastDraftSchema,
} from "@solyx/core/forecast";
import type {
  Forecast,
  ForecastDraft,
  ForecastRecord,
  ForecastScenario,
  ForecastViolation,
} from "@solyx/core/forecast";
import {
  priceToEarnings,
  revenueTrend,
  statementMetrics,
} from "@solyx/core/fundamentals";
import type { Fundamentals } from "@solyx/core/fundamentals";
import { currencyOf, exchangeDate, symbolRefSchema } from "@solyx/core/market";
import type { Market, SymbolRef } from "@solyx/core/market";
import type { MarketData } from "@solyx/core/market-data";
import {
  ReportViolationCode,
  claimSchema,
  proseSchema,
  reportDraftSchema,
} from "@solyx/core/report";
import type { Claim, Report, ReportViolation } from "@solyx/core/report";
import type { ResearchDesk } from "@solyx/core/research";

import { defineTool } from "./tools.ts";
import { AgentToolName } from "./wire.ts";
import type { ReviseReportDetails, SubmitForecastDetails } from "./wire.ts";

export interface ResearchOptions {
  desk: ResearchDesk;
  fundamentals: Fundamentals;
  marketData: Pick<MarketData, "candles">;
  /** @default () => new Date() */
  now?: () => Date;
}

const LISTED_FORECASTS = 5;

const LISTED_QUARTERS = 8;

// A year and the month before it, so the newest month shows against the same month last year.
const LISTED_MONTHS = 13;

const reviseParameters = reportDraftSchema.extend({
  stance: reportDraftSchema.shape.stance.describe(
    "Where the shares go over the coming quarters; required in a listing's first report"
  ),
  thesis: reportDraftSchema.shape.thesis.describe(
    "The argument for the stance, in a few sentences; required in a listing's first report"
  ),
  drivers: reportDraftSchema.shape.drivers.describe(
    "What carries the thesis, each with its source and the source's own words or figures"
  ),
  risks: reportDraftSchema.shape.risks.describe(
    "What could break it, sourced the same way"
  ),
  falsifiers: reportDraftSchema.shape.falsifiers.describe(
    "What would show the thesis wrong, each stated as something that happens"
  ),
  valuation: reportDraftSchema.shape.valuation.describe(
    "The range of prices you find fair and what it is measured by; null drops it"
  ),
  events: reportDraftSchema.shape.events.describe(
    "Dates ahead that could move the shares, on the exchange's calendar"
  ),
  sections: reportDraftSchema.shape.sections.describe(
    "The prose, by part: what stays true for quarters, not a chart read. A part you leave out stays as it was"
  ),
});

const forecastParameters = forecastDraftSchema.extend({
  horizon: forecastDraftSchema.shape.horizon.describe(
    `Sessions after the newest daily bar until it settles, at most ${MAX_HORIZON}`
  ),
  plan: forecastDraftSchema.shape.plan
    .default(null)
    .describe(
      "Entry, stop and target on the tick grid for long or short; left out when neutral"
    ),
  scenarios: forecastDraftSchema.shape.scenarios.describe(
    "Bands for the horizon's close that together hold every price once: the lowest has low null, the highest has high null, and each band's high is the next band's low. A band holds its low and not its high. Probabilities are whole percents adding to 100. Each path gives expected closes by session, 1 being the next session, and ends at the horizon inside its band"
  ),
  rationale: forecastDraftSchema.shape.rationale.describe(
    "Why, with the evidence and its as_of times, in the user's language"
  ),
  claims: z
    .array(claimSchema)
    .max(8)
    .default([])
    .describe("What the rationale rests on, each with its source and quote"),
  contrary: proseSchema(500)
    .nullable()
    .default(null)
    .describe(
      "Why it goes against the report's stance; needed for a long under a bearish report or a short under a bullish one"
    ),
});

const day = (market: Market, at: number) => exchangeDate(market, new Date(at));

const sessions = (count: number) =>
  `${count} ${count === 1 ? "session" : "sessions"}`;

const signed = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;

function bandText({ low, high }: Pick<ForecastScenario, "low" | "high">) {
  if (low === null) return `below ${high}`;

  return high === null ? `${low} and above` : `${low} to ${high}`;
}

/** A decisions model read the claim's quote as saying less than the claim does. */
const unsupportedText = ({ claim }: { claim: string }) =>
  `The quote given for "${claim}" does not state it. Quote the source's words or figures that do, narrow the claim to what its quote says, or leave the claim out.`;

function reportViolationText(violation: ReportViolation): string {
  switch (violation.code) {
    case ReportViolationCode.MissingStance:
      return "The listing has no report yet, so this one needs a stance.";
    case ReportViolationCode.MissingThesis:
      return "The listing has no report yet, so this one needs a thesis.";
    case ReportViolationCode.ValuationInverted:
      return `The valuation's low ${violation.low} is above its high ${violation.high}.`;
    case ReportViolationCode.ClaimUnsupported:
      return unsupportedText(violation);
  }
}

function forecastViolationText(
  violation: ForecastViolation,
  draft: ForecastDraft
): string {
  const label = (scenario: number) => draft.scenarios[scenario].label;

  switch (violation.code) {
    case ForecastViolationCode.NoReport:
      return "The listing has no report. Write one with revise_report first.";
    case ForecastViolationCode.ReportStale:
      return `The report was revised before the quarter ending ${violation.periodEnd} was out. Read it with get_fundamentals, revise the report with revise_report, then submit again.`;
    case ForecastViolationCode.AlreadyForecast:
      return `The listing already has a forecast anchored on ${violation.date}, and a session takes one. It stays as made; forecast again once the next session has a bar.`;
    case ForecastViolationCode.ContraryUnexplained:
      return `The direction goes against the report's ${violation.stance} stance. Give the reason in contrary, or revise the report first if its stance no longer holds.`;
    case ForecastViolationCode.ProbabilitySum:
      return `The probabilities add up to ${violation.sum}, not 100.`;
    case ForecastViolationCode.BandsBroken:
      return "The bands do not hold every price once. The lowest needs low null, the highest high null, and each band's high must equal the next band's low.";
    case ForecastViolationCode.PathBroken:
      return `The path of "${label(violation.scenario)}" must list sessions in rising order and end at session ${draft.horizon}, the horizon.`;
    case ForecastViolationCode.PathOutsideBand:
      return `The path of "${label(violation.scenario)}" ends at ${violation.price}, outside its own band.`;
    case ForecastViolationCode.PlanMissing:
      return "A long or short forecast needs a plan with entry, stop and target.";
    case ForecastViolationCode.PlanUnexpected:
      return "A neutral forecast takes no plan.";
    case ForecastViolationCode.InvalidPrice:
      return `The plan's price ${violation.price} is not on the ${violation.tick} tick.`;
    case ForecastViolationCode.StopWrongSide:
      return "The stop must lie below the entry for a long and above it for a short.";
    case ForecastViolationCode.TargetWrongSide:
      return "The target must lie above the entry for a long and below it for a short.";
    case ForecastViolationCode.RewardBelowRisk:
      return `The target pays ${violation.reward} against ${violation.risk} risked to the stop; it must pay at least as much.`;
    case ForecastViolationCode.ClaimUnsupported:
      return unsupportedText(violation);
  }
}

const claimText = (claim: Claim) =>
  `- ${claim.text} [${claim.source}: "${claim.quote}"]`;

function reportText(report: Report): string {
  const { market } = report.symbol;

  const listed = (title: string, lines: string[]) =>
    lines.length > 0 ? [`${title}:`, ...lines] : [];

  return [
    `Report revision ${report.revision}, revised ${day(market, report.revisedAt)}: ${report.stance}`,
    `Thesis: ${report.thesis}`,
    ...listed("Drivers", report.drivers.map(claimText)),
    ...listed("Risks", report.risks.map(claimText)),
    ...listed(
      "Falsifiers",
      report.falsifiers.map((falsifier) => `- ${falsifier}`)
    ),
    ...(report.valuation
      ? [
          `Valuation: ${report.valuation.low} to ${report.valuation.high} (${report.valuation.basis})`,
        ]
      : []),
    ...listed(
      "Events",
      report.events.map((event) => `- ${event.date} ${event.label}`)
    ),
    ...Object.entries(report.sections).flatMap(([section, part]) => [
      `## ${section}, written ${day(market, part.revisedAt)}`,
      part.text,
    ]),
  ].join("\n");
}

function forecastText(forecast: Forecast): string {
  const { anchor, plan, outcome, scenarios } = forecast;

  const lines = [
    `- ${forecast.id}: ${forecast.direction} over ${sessions(forecast.horizon)} from ${anchor.date} at ${anchor.price}, under report revision ${forecast.reportRevision}`,
    `  scenarios: ${scenarios
      .map(
        (scenario) =>
          `${scenario.label} (${bandText(scenario)}) ${scenario.probability}%`
      )
      .join(", ")}`,
  ];

  if (plan) {
    lines.push(
      `  plan: entry ${plan.entry}, stop ${plan.stop}, target ${plan.target}`
    );
  }

  if (!outcome) {
    lines.push("  outcome: open until its horizon's session closes");

    return lines.join("\n");
  }

  const planned = outcome.plan
    ? `; plan ${outcome.plan.result}${outcome.plan.r === null ? "" : ` at ${signed(outcome.plan.r)}R`}`
    : "";

  lines.push(
    `  outcome: closed ${outcome.close} on ${outcome.date}, in "${scenarios[outcome.scenario].label}", Brier ${outcome.brier.toFixed(2)}${planned}`
  );

  return lines.join("\n");
}

function recordText(scope: string, record: ForecastRecord): string {
  if (record.settled === 0) {
    return `Record, ${scope}: ${record.forecasts} forecasts, none settled yet.`;
  }

  const plans = Object.entries(record.plans)
    .map(([result, count]) => `${count} ${result}`)
    .join(", ");

  const held = record.calibration
    .filter((bucket) => bucket.scenarios > 0)
    .map(
      (bucket) =>
        `${bucket.from}-${bucket.to}% held ${bucket.held} of ${bucket.scenarios}`
    )
    .join("; ");

  return [
    `Record, ${scope}: ${record.forecasts} forecasts, ${record.settled} settled, mean Brier ${record.brier?.toFixed(2)} (0 is sure and right; even odds over three bands score 0.67)`,
    `  plans: ${plans}${record.meanR === null ? "" : `; mean ${signed(record.meanR)}R of those entered`}`,
    `  scenarios by the probability you gave: ${held}`,
  ].join("\n");
}

const percent = (value: number | null) =>
  value === null
    ? "n/a"
    : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;

const margin = (value: number | null) =>
  value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;

const millions = (value: number | null) =>
  value === null ? "n/a" : String(Math.round(value / 1e6));

const figure = (value: number | null) =>
  value === null ? "n/a" : String(Number(value.toFixed(2)));

/** Where the shares trade against their trailing earnings now, and where they have over the bars the chart keeps. */
async function valuationText(
  symbol: SymbolRef,
  { fundamentals, marketData }: ResearchOptions
): Promise<string> {
  const statements = await fundamentals.statements(symbol);
  const newest = statementMetrics(statements).at(-1);

  if (!newest || newest.trailingEps === null || newest.trailingEps <= 0) {
    return "Price to earnings: none, since the last four quarters have no EPS that adds up to a profit.";
  }

  const unpriced = `Price to earnings: no bars to price trailing EPS ${figure(newest.trailingEps)} against.`;
  let weekly;

  try {
    weekly = await marketData.candles(symbol, Interval.OneWeek);
  } catch {
    // The statements still read while bars are out of reach.
    return unpriced;
  }

  const history = priceToEarnings(symbol.market, weekly, statements);
  const latest = weekly.at(-1);

  if (!latest || history.length === 0) return unpriced;

  const multiples = history.map(({ pe }) => pe);

  return [
    `Price to earnings: ${figure(latest.close / newest.trailingEps)}, the close of ${latest.close} in the week of ${candleDate(symbol.market, latest.time)} over trailing EPS ${figure(newest.trailingEps)} (four quarters through ${newest.statement.periodEnd}).`,
    `  Over weekly closes since ${history[0].date}, each against the trailing EPS public that week: low ${figure(Math.min(...multiples))}, median ${figure(median(multiples))}, high ${figure(Math.max(...multiples))}.`,
  ].join("\n");
}

/**
 * The agent's research on a listing: `get_research` to read it, `revise_report` to keep its view
 * over quarters, and `submit_forecast` to put a forecast on record, where it is frozen and later
 * scored. `get_fundamentals` reads the filed figures a report rests on. None of them reaches an
 * order, and none changes anything outside the app, so none asks.
 */
export function createResearch(options: ResearchOptions): Extension {
  const { desk, fundamentals } = options;
  const now = options.now ?? (() => new Date());

  return defineExtension({
    name: "solyx-research",
    tools: [
      defineTool({
        name: AgentToolName.GetResearch,
        replay: "safe",
        description: `What the app holds of a listing's research: its report with when each part was written, its last ${LISTED_FORECASTS} forecasts with how those past their horizon came out, and how your forecasts have held, for this listing and for every listing. A report is what you thought when you wrote it, never current data.`,
        parameters: z.object({ symbol: symbolRefSchema }),
        async execute({ symbol }) {
          const [coverage, overall] = await Promise.all([
            desk.coverage(symbol),
            desk.trackRecord(),
          ]);

          const forecasts = takeRight(
            coverage.forecasts,
            LISTED_FORECASTS
          ).toReversed();

          return {
            text: [
              coverage.report
                ? reportText(coverage.report)
                : `${symbol.market} ${symbol.symbol} has no report yet.`,
              ...(coverage.newerFinancials
                ? [
                    `The report was revised before the quarter ending ${coverage.newerFinancials} was out. Revise it with that quarter before forecasting.`,
                  ]
                : []),
              "",
              forecasts.length > 0
                ? ["Forecasts, newest first:", ...forecasts.map(forecastText)]
                : ["No forecasts yet."],
              "",
              recordText("this listing", coverage.record),
              recordText("every listing", overall),
            ]
              .flat()
              .join("\n"),
            details: { symbol },
          };
        },
      }),

      defineTool({
        name: AgentToolName.GetFundamentals,
        replay: "safe",
        description: `A listing's filed figures, computed by the app: its last ${LISTED_QUARTERS} quarterly income statements, each for that quarter alone, with margins, growth on the year and on the quarter, and trailing four-quarter EPS; its monthly revenue with growth; and its price-to-earnings multiple now against the range it has traded in. Taiwan listings only for now, and none for an ETF. Cite these rather than work them out again.`,
        parameters: z.object({ symbol: symbolRefSchema }),
        async execute({ symbol }) {
          const [statements, monthly] = await Promise.all([
            fundamentals.statements(symbol),
            fundamentals.monthlyRevenue(symbol),
          ]);

          if (statements.length === 0 && monthly.length === 0) {
            return {
              text: `No fundamentals for ${symbol.market} ${symbol.symbol}: it files no statements, as an ETF does not, or no source covers its market yet.`,
              details: { symbol },
            };
          }

          const quarters = takeRight(
            statementMetrics(statements),
            LISTED_QUARTERS
          ).map((each) =>
            [
              each.statement.periodEnd,
              millions(each.statement.revenue),
              percent(each.revenueYoY),
              percent(each.revenueQoQ),
              margin(each.grossMargin),
              margin(each.operatingMargin),
              margin(each.netMargin),
              figure(each.statement.eps),
              percent(each.epsYoY),
              figure(each.trailingEps),
            ].join(",")
          );

          const months = takeRight(revenueTrend(monthly), LISTED_MONTHS).map(
            (each) =>
              [
                each.month,
                millions(each.revenue),
                percent(each.yoy),
                percent(each.mom),
              ].join(",")
          );

          const currency = currencyOf(symbol.market);

          return {
            text: [
              `${symbol.market} ${symbol.symbol} fundamentals as filed, as_of ${exchangeDate(symbol.market, now())}; amounts in ${currency} millions`,
              ...(quarters.length > 0
                ? [
                    "Quarters, each for the quarter alone, by its last day:",
                    "quarter,revenue,revenue yoy,revenue qoq,gross margin,operating margin,net margin,eps,eps yoy,trailing eps",
                    ...quarters,
                    await valuationText(symbol, options),
                  ]
                : ["No quarterly statements."]),
              ...(months.length > 0
                ? [
                    "Monthly revenue, unaudited:",
                    "month,revenue,yoy,mom",
                    ...months,
                  ]
                : []),
            ].join("\n"),
            details: { symbol },
          };
        },
      }),

      defineTool({
        name: AgentToolName.ReviseReport,
        // A second run would keep the same revision twice.
        replay: "unsafe",
        description:
          "Keeps a new revision of a listing's report: your view over quarters, which forecasts are then made under. Send only what changed; a part you leave out stays as the last revision had it, and every revision is kept.",
        parameters: reviseParameters,
        async execute(draft) {
          const revision = await desk.revise(draft);

          if (!revision.ok) {
            throw new Error(
              `The report was not kept.\n${revision.violations.map(reportViolationText).join("\n")}`
            );
          }

          const { symbol, revision: number } = revision.report;

          return {
            text: `Kept revision ${number} of the ${symbol.market} ${symbol.symbol} report.`,
            details: { symbol, revision: number } satisfies ReviseReportDetails,
          };
        },
      }),

      defineTool({
        name: AgentToolName.SubmitForecast,
        // The forecast's id is kept with the call, so a call that runs again finds what it made.
        replay: "safe",
        description:
          "Puts a forecast for a listing on record under its report. The app anchors it on the newest daily bar, freezes it, and scores it once its horizon's session closes: the probabilities against the band the close lands in, and the plan against the bars, with every tie counted against the plan. One per listing per session. It is no order and reaches no broker.",
        parameters: forecastParameters,
        async execute(draft, api, context) {
          const id = await api.memo(
            "forecast-id",
            crypto.randomUUID(),
            context
          );

          const result = await desk.forecast({ ...draft, id });

          if (!result.ok) {
            throw new Error(
              `The forecast was not kept. Fix these and submit again.\n${result.violations
                .map((violation) => forecastViolationText(violation, draft))
                .join("\n")}`
            );
          }

          const { forecast } = result;

          return {
            text: `Kept and frozen:\n${forecastText(forecast)}`,
            details: {
              symbol: {
                market: forecast.instrument.market,
                symbol: forecast.instrument.symbol,
              },
              forecastId: forecast.id,
            } satisfies SubmitForecastDetails,
          };
        },
      }),
    ],
  });
}
