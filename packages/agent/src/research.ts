import { defineExtension } from "@earendil-works/pi-durable";
import type { Extension } from "@earendil-works/pi-durable";
import { takeRight } from "es-toolkit";
import * as z from "zod";

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
import { exchangeDate, symbolRefSchema } from "@solyx/core/market";
import type { Market } from "@solyx/core/market";
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
}

const LISTED_FORECASTS = 5;

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

function reportViolationText(violation: ReportViolation): string {
  switch (violation.code) {
    case ReportViolationCode.MissingStance:
      return "The listing has no report yet, so this one needs a stance.";
    case ReportViolationCode.MissingThesis:
      return "The listing has no report yet, so this one needs a thesis.";
    case ReportViolationCode.ValuationInverted:
      return `The valuation's low ${violation.low} is above its high ${violation.high}.`;
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

/**
 * The agent's research on a listing: `get_research` to read it, `revise_report` to keep its view
 * over quarters, and `submit_forecast` to put a forecast on record, where it is frozen and later
 * scored. None of them reaches an order or anything outside the app, so none asks.
 */
export function createResearch({ desk }: ResearchOptions): Extension {
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
        name: AgentToolName.ReviseReport,
        // A second run would keep the same revision twice.
        replay: "unsafe",
        description:
          "Keeps a new revision of a listing's report: your view over quarters, which forecasts are then made under. Send only what changed; a part you leave out stays as the last revision had it, and every revision is kept.",
        parameters: reviseParameters,
        async execute(draft) {
          const revision = desk.revise(draft);

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
