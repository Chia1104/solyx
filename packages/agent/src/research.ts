import { defineExtension } from "@earendil-works/pi-durable";
import type {
  ConversationId,
  Extension,
  ToolExecutionApi,
} from "@earendil-works/pi-durable";
import { median, takeRight } from "es-toolkit";
import * as z from "zod";

import { Interval, candleDate } from "@solyx/core/candles";
import {
  ForecastViolationCode,
  MAX_HORIZON,
  bandsBetween,
  forecastDraftSchema,
  moveQuantile,
} from "@solyx/core/forecast";
import type {
  Forecast,
  ForecastDraft,
  ForecastRecord,
  ForecastViolation,
} from "@solyx/core/forecast";
import {
  balanceSheetMetrics,
  cashFlowMetrics,
  premium,
  priceToEarnings,
  revenueTrend,
  statementMetrics,
  trailingCash,
} from "@solyx/core/fundamentals";
import { GovernanceKind } from "@solyx/core/fundamentals";
import type {
  Company,
  Dividend,
  ExchangeMultiples,
  FundCosts,
  FundProfile,
  Fundamentals,
  GovernanceRecord,
  MultipleStanding,
  NetAssetValue,
  PeerStanding,
} from "@solyx/core/fundamentals";
import {
  BENCHMARK,
  currencyOf,
  exchangeDate,
  symbolRefSchema,
  symbolLabel,
} from "@solyx/core/market";
import type { Market, SymbolRef } from "@solyx/core/market";
import type { MarketData } from "@solyx/core/market-data";
import { TimePrecision } from "@solyx/core/news";
import {
  ReportViolationCode,
  claimSchema,
  proseSchema,
  reportDraftSchema,
} from "@solyx/core/report";
import type {
  Argument,
  Report,
  ReportViolation,
  StanceSpell,
} from "@solyx/core/report";
import { WatchGap } from "@solyx/core/research";
import type {
  FalsifierCheck,
  FalsifierWatch,
  ResearchDesk,
} from "@solyx/core/research";
import { regularHours } from "@solyx/core/session";
import { errorMessage } from "@solyx/utils/error";
import { counted, truncate } from "@solyx/utils/text";

import { evidenceText } from "./evidence-text.ts";
import {
  bandText,
  figure,
  millions,
  percent,
  percentChange,
  signed,
} from "./figures.ts";
import {
  durableScenarioBox,
  forecastMotion,
  scenarioCouncilsText,
} from "./magi.ts";
import type { MagiPort } from "./magi.ts";
import { quoteChecker } from "./provenance.ts";
import { defineTool, eventDay, publishedTime } from "./tools.ts";
import type { ToolOutput } from "./tools.ts";
import { AgentToolName } from "./wire.ts";
import type { ReviseReportDetails, SubmitForecastDetails } from "./wire.ts";

export interface ResearchOptions {
  desk: ResearchDesk;
  fundamentals: Fundamentals;
  marketData: Pick<MarketData, "candles">;
  /** Puts each forecast to a vote while the user has decisions go to the MAGI. */
  magi?: MagiPort;
  /**
   * Everything a conversation's tools returned and its user wrote, which a new quote must be the
   * words of; without it no quote is checked.
   */
  read?: (conversationId: ConversationId) => Promise<string[]>;
  /** @default () => new Date() */
  now?: () => Date;
}

const LISTED_FORECASTS = 5;

// The spread of a horizon's moves, from its low tail to its high one.
const BASE_RATE_QUANTILES = [0.1, 0.25, 0.5, 0.75, 0.9];

const LISTED_QUARTERS = 8;

// A year and the month before it, so the newest month shows against the same month last year.
const LISTED_MONTHS = 13;

// Two years of quarterly distributions.
const LISTED_DIVIDENDS = 8;

const reviseParameters = reportDraftSchema.extend({
  stance: reportDraftSchema.shape.stance.describe(
    "Where the shares go over the coming quarters; required in a listing's first report"
  ),
  thesis: reportDraftSchema.shape.thesis.describe(
    "The argument for the stance, in a few sentences; required in a listing's first report"
  ),
  drivers: reportDraftSchema.shape.drivers.describe(
    "What carries the thesis. Each has a point, your own reading of why it matters, and the fact it rests on: text says only what quote says, with no cause, forecast or comparison the quote does not give, and quote is the source's own words or figures in full, never shortened with an ellipsis, covering every row a fact sums up"
  ),
  risks: reportDraftSchema.shape.risks.describe(
    "What could break it, each a point resting on a fact in the same way"
  ),
  falsifiers: reportDraftSchema.shape.falsifiers.describe(
    "What would show the thesis wrong, each stated as something that happens"
  ),
  valuation: reportDraftSchema.shape.valuation.describe(
    "The range of prices you find fair and what it is measured by; null drops it"
  ),
  events: reportDraftSchema.shape.events.describe(
    "Dates ahead that could move the shares and that get_calendar does not already list, such as an earnings call, a shareholders' meeting, a launch or a ruling, on the exchange's calendar; the app's calendar shows them from then on. label says what happens and no more than quote does; quote is the source's own words that give the day, in full; timing is set when whoever holds the event set the day, deadline for the latest day it may come, and expected when a source only expects it. A day already behind today is refused. Sending events replaces the whole list"
  ),
  sections: reportDraftSchema.shape.sections.describe(
    "The prose, by part: what stays true for quarters, not a chart read. A part you leave out stays as it was"
  ),
});

const forecastParameters = forecastDraftSchema.extend({
  horizon: forecastDraftSchema.shape.horizon.describe(
    `Sessions after the newest daily bar until it settles, at most ${MAX_HORIZON}`
  ),
  direction: forecastDraftSchema.shape.direction.describe(
    "Which way your probabilities lean from the shares get_base_rates gave for your bands: long where they give the bands above the last close more and those below less, short for the reverse, neutral where they stay on history's"
  ),
  plan: forecastDraftSchema.shape.plan
    .default(null)
    .describe(
      "Entry, stop and target on the tick grid, only where the lean is one you would trade; a long or short may go without, and a neutral forecast takes none"
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
    .describe(
      "Facts the rationale rests on, each saying no more than its quote, which is given in full and never shortened with an ellipsis; what you make of them belongs in the rationale"
    ),
  contrary: proseSchema(500)
    .nullable()
    .default(null)
    .describe(
      "Why it goes against the report's stance; needed for a long under a bearish report or a short under a bullish one"
    ),
});

const day = (market: Market, at: number) => exchangeDate(market, new Date(at));

/** A lean in points of probability, by its side. */
function leanText(lean: number): string {
  const size = Math.round(Math.abs(lean) * 100);

  if (size === 0) return "neither way";

  return `${counted(size, "point")} ${lean > 0 ? "up" : "down"}`;
}

/** What a quote was given for, and the quote. */
interface Quoted {
  /** The claim's fact or the event's label, which names it to the model. */
  about: string;
  quote: string;
}

/** A quote none of whose source the conversation read, by the first of its lines that is in nothing it read. */
const unreadQuoteText = ({ about }: Quoted, line: string) =>
  `The quote given for "${about}" is not the words of anything this conversation read: no tool returned "${line}" and the user did not write it. Copy a quote as it stands in a tool's answer or a page you read, a table's rows one to a line, and read the source first where you have not.`;

/** A decisions model read the claim's quote as saying less than the claim does. */
const unsupportedText = ({ claim }: { claim: string }) =>
  `The quote given for "${claim}" does not state it. Keep text to what the quote says and put what you make of it in point, or in the rationale of a forecast; or quote the words or figures that do state it; or leave it out.`;

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
    case ReportViolationCode.EventPassed:
      return `The event "${violation.label}" is dated ${violation.date}, which has passed. Events are dates ahead: leave it out, and say what came of it in the catalysts section or in a driver or risk.`;
    case ReportViolationCode.EventUnsupported:
      return `The quote given for the event "${violation.label}" does not give ${violation.date} for it. Quote the source's words that name the day, set timing to expected when the source only expects it, or leave the event out.`;
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
    case ForecastViolationCode.LeanOpposed:
      return `The forecast is ${draft.direction}, but against the shares history gives its bands its probabilities lean ${leanText(violation.lean)}. A long gives the bands above the last close more than history and those below less, and a short the reverse: move the probabilities as far as your evidence carries them, or say neutral where it carries them no way.`;
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

const argumentText = (argument: Argument) =>
  `- ${argument.point}\n  rests on: ${argument.text} [${argument.source}: "${argument.quote}"]`;

/** How each stretch of one stance did against the market's index on total return, the standing one last. */
function stancesText(
  market: Market,
  stances: readonly StanceSpell[]
): string[] {
  if (stances.length === 0) return [];

  return [
    `Stance against ${BENCHMARK[market].totalReturn}, each stretch the report kept one, the listing on total return too, splits and capital reductions made up for:`,
    ...stances.map(
      (spell) =>
        `- ${spell.stance} from ${spell.from} (revision ${spell.revision}) ${spell.until === null ? "and standing" : `to ${spell.until}`}, ${counted(spell.sessions, "session")}: ${percentChange(spell.change, 1)} against the index's ${percentChange(spell.benchmark, 1)}, ${points(spell.change - spell.benchmark)}`
    ),
  ];
}

/** A report as the model reads it, each of its `passed` events marked as no longer ahead. */
function reportText(
  report: Report,
  passed: readonly Report["events"][number][]
): string {
  const { market } = report.symbol;

  const eventText = (event: Report["events"][number]) =>
    `- ${eventDay(event.date, event.timing)} ${event.label}${
      passed.includes(event)
        ? " (passed: say what came of it and drop it when you next revise)"
        : ""
    } [${event.source}: "${event.quote}"]`;

  const listed = (title: string, lines: string[]) =>
    lines.length > 0 ? [`${title}:`, ...lines] : [];

  return [
    `Report revision ${report.revision}, revised ${day(market, report.revisedAt)}: ${report.stance}`,
    `Thesis: ${report.thesis}`,
    ...listed("Drivers", report.drivers.map(argumentText)),
    ...listed("Risks", report.risks.map(argumentText)),
    ...listed(
      "Falsifiers",
      report.falsifiers.map((falsifier) => `- ${falsifier}`)
    ),
    ...(report.valuation
      ? [
          `Valuation: ${report.valuation.low} to ${report.valuation.high} (${report.valuation.basis})`,
        ]
      : []),
    ...listed("Events", report.events.map(eventText)),
    ...Object.entries(report.sections).flatMap(([section, part]) => [
      `## ${section}, written ${day(market, part.revisedAt)}`,
      part.text,
    ]),
  ].join("\n");
}

export function forecastText(forecast: Forecast): string {
  const { instrument, anchor, plan, outcome, scenarios } = forecast;

  const lines = [
    `- ${forecast.id}: ${symbolLabel(instrument)} ${forecast.direction} over ${counted(forecast.horizon, "session")} from ${anchor.date} at ${anchor.price}, under report revision ${forecast.reportRevision}`,
    `  scenarios: ${scenarios
      .map(
        (scenario) =>
          `${scenario.label} (${bandText(scenario.low, scenario.high)}) ${scenario.probability}%`
      )
      .join(", ")}`,
  ];

  if (forecast.baseRates) {
    lines.push(
      `  history alone: ${forecast.baseRates.map((rate) => `${Math.round(rate * 100)}%`).join(", ")}, in the scenarios' order`
    );
  }

  if (forecast.evidence) {
    lines.push(`  its facts: ${evidenceText(forecast.evidence)}`);
  }

  if (forecast.motions) {
    const carried = scenarios.filter(
      (_, index) => forecast.motions?.[index]?.carried
    );

    lines.push(
      `  the MAGI carried as more likely than history: ${carried.length === 0 ? "none" : carried.map(({ label }) => label).join(", ")}`
    );
  }

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
    `  outcome: closed ${outcome.close} on ${outcome.date}${outcome.adjustedClose === outcome.close ? "" : `, judged at ${figure(outcome.adjustedClose)} with what went ex or split after the anchor made up for`}, in "${scenarios[outcome.scenario].label}", Brier ${outcome.brier.toFixed(2)}${planned}`
  );

  return lines.join("\n");
}

/** What the MAGI made of a forecast just kept, where decisions go to it. */
function votedText(forecast: Forecast, asked: boolean): string[] {
  const { motions, baseRates: rates, scenarios } = forecast;

  if (!asked) return [];

  if (!motions || !rates) {
    return [
      "The MAGI held no vote: the listing's bars hold too few moves of that length to give its bands a history to vote against.",
    ];
  }

  return [
    scenarioCouncilsText({ scenarios, baseRates: rates, motions }),
    "The forecast is kept however they voted. Tell the user which scenarios carried and each unit's reason, and where the vote leans another way than your probabilities, say what the units weighed differently.",
  ];
}

/** News a decisions model read as stating that a falsifier happened, newest first. */
function signalsText(
  market: Market,
  signals: readonly FalsifierCheck[]
): string[] {
  if (signals.length === 0) return [];

  return [
    "",
    "Falsifiers news may say happened, as a decisions model read each item against the falsifier; read the item before you rely on it:",
    ...signals.map(
      ({ falsifier, item, support }) =>
        `- "${falsifier}": ${publishedTime(market, item.published)} ${item.site}: ${item.title} (read as stated, ${support.supported.toFixed(2)})${item.url ? ` ${item.url}` : ""}`
    ),
  ];
}

const WATCH_GAP_TEXT = {
  [WatchGap.NoLocalEmbedder]:
    "no Ollama model embeds news (in Settings, grouping news by meaning, with vectors from Ollama)",
  [WatchGap.Unmeasured]:
    "the Ollama model has no floor measured for reading news against a falsifier",
  [WatchGap.NoAuditor]: "no decisions model is set up",
} as const satisfies Record<WatchGap, string>;

/** Whether the news is read against the falsifiers, so no signal is not taken for quiet news. */
function watchText(
  market: Market,
  watch: FalsifierWatch | null,
  quiet: boolean
): string[] {
  if (!watch) return [];

  const { gaps, pass } = watch;

  if (gaps.length > 0) {
    return [
      "",
      `News is not read against the falsifiers while ${gaps.map((gap) => WATCH_GAP_TEXT[gap]).join(" and ")}, so no signal says nothing of the news.`,
    ];
  }

  if (!pass) {
    return [
      "",
      "The falsifiers have not been read against the news since this revision; the listing's next news collection reads them.",
    ];
  }

  const at = publishedTime(market, {
    at: new Date(pass.at),
    precision: TimePrecision.Minute,
  });

  if (pass.failure !== null) {
    return [
      "",
      `Reading the falsifiers against the news failed at ${at}: ${pass.failure}. The next news collection tries again.`,
    ];
  }

  return [
    "",
    [
      `The falsifiers were last read against ${pass.items} news items of the week before ${at}.`,
      ...(quiet ? ["No item has read as stating one."] : []),
      ...(pass.unread > 0
        ? [
            `${pass.unread} near one could not be read and wait for the next collection.`,
          ]
        : []),
    ].join(" "),
  ];
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
    ...(record.skill
      ? [
          `  against history's base rates, over ${record.skill.forecasts} settled: Brier ${record.skill.brier.toFixed(2)} against ${record.skill.baseBrier.toFixed(2)} for the base rates${record.skill.skill === null ? "" : `, skill ${percentChange(record.skill.skill, 1)} (0 is no better than history alone, below it worse)`}`,
        ]
      : []),
    ...(record.motions
      ? [
          `  scenarios the MAGI carried as more likely than history: the close landed in ${record.motions.held} of ${record.motions.calls}, where history alone expects ${record.motions.expected.toFixed(1)}`,
        ]
      : []),
    ...(record.evidence
      ? [
          `  the side a decisions model read the facts towards: the close landed there in ${record.evidence.held} of ${record.evidence.calls}, where history alone expects ${record.evidence.expected.toFixed(1)}`,
        ]
      : []),
    `  plans: ${plans}${record.meanR === null ? "" : `; mean ${signed(record.meanR)}R of those entered`}`,
    `  scenarios by the probability you gave: ${held}`,
  ].join("\n");
}

/** A gap between two changes, in the percentage points one stands above the other. */
const points = (gap: number) => `${signed(gap * 100, 1)} points`;

/** A figure in whole millions, `n/a` where it is missing. */
const inMillions = (value: number | null) =>
  figure(value === null ? null : millions(value));

/** A distribution's day: "none" without that part, "not set" while the company has not set it. */
const distributionDay = (amount: number, day: string | null) =>
  amount === 0 ? "none" : (day ?? "not set");

function dividendRow(dividend: Dividend): string {
  return [
    dividend.announced ?? "not given",
    dividend.period,
    figure(dividend.cash),
    distributionDay(dividend.cash, dividend.cashExDate),
    distributionDay(dividend.cash, dividend.cashPaidOn),
    figure(dividend.stock),
    distributionDay(dividend.stock, dividend.stockExDate),
  ].join(",");
}

/** What a source filed of one kind, or why it could not be read, so one that fails leaves the others to read. */
async function filed<Row>(
  asked: Promise<Row[]>
): Promise<{ rows: Row[]; failure: string | null }> {
  try {
    return { rows: await asked, failure: null };
  } catch (error) {
    return { rows: [], failure: errorMessage(error) };
  }
}

/** What a fund is, as its exchange lists it, a line for each thing the exchange says. */
function fundText(fund: FundProfile): string[] {
  return [
    `A fund, as its exchange lists it, as_of ${fund.asOf}: ${fund.name}`,
    `  kind: ${fund.category}`,
    `  tracks: ${fund.index ?? "no index"}`,
    ...(fund.benchmark === null
      ? []
      : [`  measures itself against: ${fund.benchmark}`]),
    ...(fund.foreignHoldings === null
      ? []
      : [
          `  may hold securities listed abroad: ${fund.foreignHoldings ? "yes" : "no"}`,
        ]),
    ...(fund.listedOn === null ? [] : [`  listed: ${fund.listedOn}`]),
    ...(fund.manager === null ? [] : [`  manager: ${fund.manager}`]),
    ...(fund.units === null ? [] : [`  units outstanding: ${fund.units}`]),
  ];
}

/** A fund's net asset value, and where its close of the same session stood against it. */
async function netAssetValueText(
  symbol: SymbolRef,
  nav: NetAssetValue,
  { marketData }: ResearchOptions
): Promise<string> {
  const value = `Net asset value as its issuer struck it for ${nav.date}: ${nav.value} ${currencyOf(symbol.market)} a unit.`;
  const unpriced = `${value} No close of that session to set it against.`;
  let daily;

  try {
    daily = await marketData.candles(symbol, Interval.OneDay);
  } catch {
    // The value still reads while bars are out of reach.
    return unpriced;
  }

  const bar = daily.find(
    ({ time }) => candleDate(symbol.market, time) === nav.date
  );

  if (!bar) return unpriced;

  const gap = premium(bar.close, nav);

  return `${value} Its close that session, ${bar.close}, stood at a ${gap < 0 ? "discount" : "premium"} of ${(Math.abs(gap) * 100).toFixed(2)}% to it.`;
}

/** What a fund paid out of its assets over a month, and at that month's pace over a year. */
function fundCostsText(costs: FundCosts): string[] {
  const parts = [
    costs.management,
    costs.custody,
    costs.guarantee,
    costs.commission,
    costs.tax,
    costs.other,
    costs.total,
  ];

  return [
    "What it paid out of its assets, in percent of its net assets:",
    "period,management,custody,guarantee,commission,tax,other,total",
    [costs.month, ...parts.map((part) => figure(part, 5))].join(","),
    ["a year at that pace", ...parts.map((part) => figure(part * 12, 3))].join(
      ","
    ),
    "  Commission and tax are paid on the fund's own trades, so they run high in a month it rebalances.",
  ];
}

/** A listing's multiples as its exchange works them out, which are not the app's own beside its statements. */
function multiplesText(multiples: ExchangeMultiples): string {
  const dividendYield =
    multiples.dividendYield === null
      ? "n/a"
      : `${figure(multiples.dividendYield)}%`;

  return `Multiples as its exchange works them out from the close of ${multiples.asOf}: price to earnings ${figure(multiples.priceToEarnings)}, dividend yield ${dividendYield}, price to book ${figure(multiples.priceToBook)}.`;
}

/** One multiple against the same multiple of the industry's other listings. */
function standingText(
  name: string,
  { value, peers, median: middle, above }: MultipleStanding,
  unit = ""
): string {
  if (value === null || middle === null || above === null) {
    return `${name} n/a`;
  }

  return `${name} ${figure(value)}${unit} against a median of ${figure(middle)}${unit}, above ${Math.round(above * 100)}% of the ${peers} with one`;
}

/** A listing's multiples against its industry's, as its exchanges class and work them out. */
function peersText(peers: PeerStanding): string {
  return `Among the ${peers.listings} listings its exchanges class as ${peers.industry.name}, itself aside: ${[
    standingText("price to earnings", peers.priceToEarnings),
    standingText("dividend yield", peers.dividendYield, "%"),
    standingText("price to book", peers.priceToBook),
  ].join("; ")}.`;
}

/**
 * The shares a company has issued, and what they were worth and how many of them traded in its
 * last finished session: a bar of a session still under way is no close.
 */
async function sharesText(
  symbol: SymbolRef,
  { shares }: Company,
  { marketData }: ResearchOptions,
  now: Date
): Promise<string> {
  if (shares === null) {
    return "Its exchange lists no count of the shares its listing trades as.";
  }

  const issued = `Shares issued, as its exchange lists them: ${shares}.`;
  let daily;

  try {
    daily = await marketData.candles(symbol, Interval.OneDay);
  } catch {
    // The count still reads while bars are out of reach.
    return issued;
  }

  const today = exchangeDate(symbol.market, now);

  const closed = daily.filter(
    ({ time }) =>
      candleDate(symbol.market, time) < today ||
      now.getTime() >= regularHours(symbol.market, today).close * 1000
  );

  const bar = closed.at(-1);

  if (!bar) return issued;

  return `${issued} At the close of ${candleDate(symbol.market, bar.time)}, ${bar.close}, they were worth ${millions(shares * bar.close)} million ${currencyOf(symbol.market)}, and that session traded ${percent(bar.volume / shares, 2)} of them.`;
}

// A sanction's text runs to several sentences of statute; its start says what was done.
const GOVERNANCE_NOTE_LENGTH = 240;

// What each kind of record is, for the model.
const GOVERNANCE_TEXT: Record<
  Exclude<GovernanceKind, typeof GovernanceKind.DirectorPledge>,
  string
> = {
  [GovernanceKind.Sanction]:
    "sanctioned by the Financial Supervisory Commission",
  [GovernanceKind.ExchangeFine]: "fined by its exchange",
  [GovernanceKind.ControlChange]: "control changed hands",
};

/** A company's newest pledge, then what else its exchanges keep on record of how it is run, newest first. */
function governanceText(records: readonly GovernanceRecord[]): string[] {
  const pledge = records.find(
    (record) => record.kind === GovernanceKind.DirectorPledge
  );

  const others = records.flatMap((record) =>
    record.kind === GovernanceKind.DirectorPledge
      ? []
      : [
          `- ${record.date}, ${GOVERNANCE_TEXT[record.kind]}: ${truncate(record.note ?? "", GOVERNANCE_NOTE_LENGTH)}`,
        ]
  );

  return [
    ...(pledge?.pledged === undefined || pledge.pledged === null
      ? []
      : [
          `Its directors and supervisors had pledged ${figure(pledge.pledged)}% of their own shares as of ${pledge.date}, as its exchange lists them each month.`,
        ]),
    ...(others.length > 0
      ? [
          "What its exchanges and the regulator keep on record of how it is run:",
          ...others,
        ]
      : []),
  ];
}

/** Why a listing has neither statements nor revenue on file with `source`. */
function nothingFiledText(
  fund: boolean,
  distributes: boolean,
  source: string
): string {
  if (fund) return "A fund files neither statements nor revenue.";

  return distributes
    ? "With distributions and neither statements nor revenue, it reads as a fund such as an ETF, which files none."
    : `With nothing on file, it is a fund that distributes nothing, a listing too new to have filed, or a code ${source} does not know.`;
}

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

  /**
   * Why each of `quoted` that is new cannot be kept: a quote the listing's report already holds
   * was read when it was first kept, and any other must be the words of something this
   * conversation read.
   */
  async function unreadQuotes(
    api: ToolExecutionApi,
    symbol: SymbolRef,
    quoted: readonly Quoted[]
  ): Promise<string[]> {
    if (!options.read) return [];

    const report = desk.report(symbol);

    const kept = new Set(
      [
        ...(report?.drivers ?? []),
        ...(report?.risks ?? []),
        ...(report?.events ?? []),
      ].map(({ quote }) => quote)
    );

    const fresh = quoted.filter(({ quote }) => !kept.has(quote));

    if (fresh.length === 0) return [];

    const unfound = quoteChecker(await options.read(api.conversationId));

    return fresh.flatMap((each) => {
      const line = unfound(each.quote);

      return line === undefined ? [] : [unreadQuoteText(each, line)];
    });
  }

  return defineExtension({
    name: "solyx-research",
    tools: [
      defineTool({
        name: AgentToolName.GetResearch,
        replay: "safe",
        description: `What the app holds of a listing's research: its report with when each part was written and which of its events have passed, how each stretch it kept one stance did against the market's index, its last ${LISTED_FORECASTS} forecasts with how those past their horizon came out, news a decisions model read as stating that one of its falsifiers happened and whether the news is read against them at all, and how your forecasts have held, for this listing and for every listing. A report is what you thought when you wrote it, never current data.`,
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
                ? reportText(coverage.report, coverage.passedEvents)
                : `${symbolLabel(symbol)} has no report yet.`,
              ...stancesText(symbol.market, coverage.stances),
              ...(coverage.newerFinancials
                ? [
                    `The report was revised before the quarter ending ${coverage.newerFinancials} was out. Revise it with that quarter before forecasting.`,
                  ]
                : []),
              "",
              forecasts.length > 0
                ? ["Forecasts, newest first:", ...forecasts.map(forecastText)]
                : ["No forecasts yet."],
              ...signalsText(symbol.market, coverage.signals),
              ...watchText(
                symbol.market,
                coverage.watch,
                coverage.signals.length === 0
              ),
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
        description: `A listing's filed figures, computed by the app: its last ${LISTED_QUARTERS} quarterly income statements, each for that quarter alone, with margins, growth on the year and on the quarter, and trailing four-quarter EPS; its monthly revenue with growth; its price-to-earnings multiple now against the range it has traded in; its balance sheets at those quarters' ends, with the current ratio and liabilities against assets; its cash flows for each quarter alone, with free cash flow and the four quarters each closes; and its last ${LISTED_DIVIDENDS} distributions with the days they go ex and are paid, those still to come among them, and the cash gone ex over the last year. Beside the app's own price-to-earnings multiple, the answer gives the multiples the listing's exchange works out from its last close, price to earnings, dividend yield and price to book, each "n/a" where the exchange works none out, as it does no price to earnings for a company whose earnings add up to a loss; a fund has none. Under them it says where each stands in the listing's industry, as the exchanges class it: against the median of the industry's other listings and the share of them it is above, counting only those with that multiple. For a fund the Taiwan Stock Exchange lists, the answer opens with what it is: its kind in the exchange's words, such as a leveraged, inverse, futures or actively managed fund, the index it tracks or what it measures itself against, whether it may hold securities listed abroad, the day it listed, its manager and its units outstanding. The Taipei Exchange publishes no such list, so a fund listed there, as bond ETFs are, opens with none. For a fund listed on either exchange, it then gives the newest net asset value its issuer struck, with the close of that session as a premium or a discount to it, and what the fund paid out of its assets over the newest month its issuer reported: management, custody, a guarantee, commission and tax on its own trades and the rest, each in percent of its net assets, and that month's pace over a year. A futures fund, or one listed abroad and offered here, has neither. The answer names its source, and each part says when that source has none on file, as it has no statements for a fund, or could not be read, which says nothing of the listing. A US listing's figures come from the user's Longbridge sign-in: quarterly statements dated by the release of their results, balance sheets without current assets and liabilities, borrowings or cash, so no current ratio, cash flows and distributions, but no monthly revenue, exchange multiples, peers, fund data or records of how the company is run. Cite these rather than work them out again.`,
        parameters: z.object({ symbol: symbolRefSchema }),
        async execute({ symbol }) {
          const listing = `${symbolLabel(symbol)}`;
          const source = fundamentals.source(symbol.market);

          if (source === undefined) {
            return {
              text: `No source covers ${symbol.market} fundamentals yet, so ${listing} has none to read. That says nothing of what it files.`,
              details: { symbol },
            };
          }

          const [
            statements,
            sheets,
            flows,
            monthly,
            dividends,
            funds,
            navs,
            costs,
            multiples,
            peers,
            companies,
            governance,
          ] = await Promise.all([
            filed(fundamentals.statements(symbol)),
            filed(fundamentals.balanceSheets(symbol)),
            filed(fundamentals.cashFlows(symbol)),
            filed(fundamentals.monthlyRevenue(symbol)),
            filed(fundamentals.dividends(symbol)),
            filed(
              fundamentals
                .fund(symbol)
                .then((fund) => (fund === null ? [] : [fund]))
            ),
            filed(
              fundamentals
                .netAssetValue(symbol)
                .then((nav) => (nav === null ? [] : [nav]))
            ),
            filed(
              fundamentals
                .fundCosts(symbol)
                .then((paid) => (paid === null ? [] : [paid]))
            ),
            filed(
              fundamentals
                .multiples(symbol)
                .then((each) => (each === null ? [] : [each]))
            ),
            filed(
              fundamentals
                .peers(symbol)
                .then((each) => (each === null ? [] : [each]))
            ),
            filed(
              fundamentals
                .company(symbol)
                .then((each) => (each === null ? [] : [each]))
            ),
            filed(fundamentals.governance(symbol)),
          ]);

          const parts = [statements, sheets, flows, monthly, dividends];

          if (parts.every(({ failure }) => failure !== null)) {
            throw new Error(
              `${listing}'s fundamentals could not be read from ${source}: ${statements.failure}`
            );
          }

          const currency = currencyOf(symbol.market);
          const today = exchangeDate(symbol.market, now());

          /** A part's lines, or that the source has none of it on file, or why it could not be read. */
          const part = (
            name: string,
            { rows, failure }: { rows: unknown[]; failure: string | null },
            lines: string[]
          ) => {
            if (failure !== null) {
              return [`${name} could not be read: ${failure}`];
            }

            return rows.length === 0
              ? [`No ${name.toLowerCase()} on file with ${source}.`]
              : lines;
          };

          const nothingFiled =
            parts.every(({ failure }) => failure === null) &&
            statements.rows.length === 0 &&
            monthly.rows.length === 0;

          return {
            text: [
              `${listing} fundamentals as filed, from ${source}, as_of ${today}; amounts in ${currency} millions`,
              ...(funds.failure === null
                ? funds.rows.flatMap(fundText)
                : [
                    `Whether its exchange lists it as a fund could not be read: ${funds.failure}`,
                  ]),
              ...(navs.failure === null
                ? await Promise.all(
                    navs.rows.map((nav) =>
                      netAssetValueText(symbol, nav, options)
                    )
                  )
                : [`Its net asset value could not be read: ${navs.failure}`]),
              ...(costs.failure === null
                ? costs.rows.flatMap(fundCostsText)
                : [
                    `What it paid out of its assets could not be read: ${costs.failure}`,
                  ]),
              ...(multiples.failure === null
                ? multiples.rows.map(multiplesText)
                : [
                    `The multiples its exchange works out could not be read: ${multiples.failure}`,
                  ]),
              // What fails the industry's standing fails the multiples above, which already say so.
              ...peers.rows.map(peersText),
              ...(companies.failure === null
                ? await Promise.all(
                    companies.rows.map((company) =>
                      sharesText(symbol, company, options, now())
                    )
                  )
                : [
                    `The shares its exchange lists it with could not be read: ${companies.failure}`,
                  ]),
              ...(governance.failure === null
                ? governanceText(governance.rows)
                : [
                    `What its exchanges keep on record of how it is run could not be read: ${governance.failure}`,
                  ]),
              ...part("Quarterly statements", statements, [
                "Quarters, each for the quarter alone, by its last day:",
                "quarter,revenue,revenue yoy,revenue qoq,gross margin,operating margin,net margin,eps,eps yoy,trailing eps",
                ...takeRight(
                  statementMetrics(statements.rows),
                  LISTED_QUARTERS
                ).map((each) =>
                  [
                    each.statement.periodEnd,
                    inMillions(each.statement.revenue),
                    percentChange(each.revenueYoY, 1),
                    percentChange(each.revenueQoQ, 1),
                    percent(each.grossMargin),
                    percent(each.operatingMargin),
                    percent(each.netMargin),
                    figure(each.statement.eps),
                    percentChange(each.epsYoY, 1),
                    figure(each.trailingEps),
                  ].join(",")
                ),
                ...(statements.rows.length > 0
                  ? [await valuationText(symbol, options)]
                  : []),
              ]),
              ...part("Balance sheets", sheets, [
                "Balance sheets, at each quarter's last day:",
                "quarter,cash,receivables,inventories,current assets,current liabilities,current ratio,short-term borrowings,long-term borrowings,bonds payable,total assets,total liabilities,liabilities to assets,equity",
                ...takeRight(
                  balanceSheetMetrics(sheets.rows),
                  LISTED_QUARTERS
                ).map(({ sheet, currentRatio, liabilitiesToAssets }) =>
                  [
                    sheet.periodEnd,
                    inMillions(sheet.cash),
                    inMillions(sheet.receivables),
                    inMillions(sheet.inventories),
                    inMillions(sheet.currentAssets),
                    inMillions(sheet.currentLiabilities),
                    figure(currentRatio),
                    inMillions(sheet.shortTermBorrowings),
                    inMillions(sheet.longTermBorrowings),
                    inMillions(sheet.bondsPayable),
                    inMillions(sheet.totalAssets),
                    inMillions(sheet.totalLiabilities),
                    percent(liabilitiesToAssets),
                    inMillions(sheet.equity),
                  ].join(",")
                ),
                "  The three borrowing lines are as filed and leave out long-term debt due within a year, so they do not add up to all it owes lenders.",
              ]),
              ...part("Cash flows", flows, [
                "Cash flows, each for the quarter alone, capital expenditure as what was paid:",
                "quarter,operating,capital expenditure,free cash flow,investing,financing,trailing operating,trailing free cash flow",
                ...takeRight(cashFlowMetrics(flows.rows), LISTED_QUARTERS).map(
                  (each) =>
                    [
                      each.flow.periodEnd,
                      inMillions(each.flow.operating),
                      inMillions(each.flow.capitalExpenditure),
                      inMillions(each.freeCashFlow),
                      inMillions(each.flow.investing),
                      inMillions(each.flow.financing),
                      inMillions(each.trailingOperating),
                      inMillions(each.trailingFreeCashFlow),
                    ].join(",")
                ),
              ]),
              ...part("Monthly revenue", monthly, [
                "Monthly revenue, unaudited:",
                "month,revenue,yoy,mom",
                ...takeRight(revenueTrend(monthly.rows), LISTED_MONTHS).map(
                  (each) =>
                    [
                      each.month,
                      inMillions(each.revenue),
                      percentChange(each.yoy, 1),
                      percentChange(each.mom, 1),
                    ].join(",")
                ),
              ]),
              ...(nothingFiled
                ? [
                    nothingFiledText(
                      [funds, navs, costs].some(({ rows }) => rows.length > 0),
                      dividends.rows.length > 0,
                      source
                    ),
                  ]
                : []),
              ...part("Distributions", dividends, [
                `Distributions, oldest first, per share in ${currency}, stock at its par value:`,
                "announced,period,cash,cash ex,cash paid,stock,stock ex",
                ...takeRight(dividends.rows, LISTED_DIVIDENDS).map(dividendRow),
                `Cash gone ex in the year through ${today}: ${figure(trailingCash(dividends.rows, today))} per share.`,
              ]),
            ].join("\n"),
            details: { symbol },
          };
        },
      }),

      defineTool({
        name: AgentToolName.GetBaseRates,
        replay: "safe",
        description: `How a listing's close has moved over a horizon in its own daily bars, before any view of it: the spread of every move of that many sessions the bars hold, and, for band edges you give, how often those moves, carried from the newest bar, land in each band. Those shares are the base rates a forecast is scored against once kept, so call it with your edges before you set the probabilities. What went ex, split or was reduced inside a move reads as no move, from the bars' reference prices, as a forecast is judged.`,
        parameters: z.object({
          symbol: symbolRefSchema,
          horizon: forecastDraftSchema.shape.horizon.describe(
            `Sessions ahead, at most ${MAX_HORIZON}`
          ),
          edges: z
            .array(z.number().positive())
            .max(3)
            .default([])
            .refine(
              (edges) =>
                edges.every(
                  (edge, index) => index === 0 || edge > edges[index - 1]
                ),
              "Edges ascend, each above the one before"
            )
            .describe(
              "The prices that part the bands, ascending: two edges make three bands, below the first, between them, and from the second up"
            ),
        }),
        async execute({ symbol, horizon, edges }) {
          const { anchor, since, moves, rates } = await desk.horizonHistory(
            symbol,
            horizon,
            edges
          );

          const listing = `${symbolLabel(symbol)}`;

          if (moves.length === 0) {
            return {
              text: `${listing} has no move of ${counted(horizon, "session")} in its daily bars since ${since}.`,
              details: { symbol },
            };
          }

          const spread = BASE_RATE_QUANTILES.map((share) => {
            const move = moveQuantile(moves, share);

            return `${share * 100}th percentile ${percentChange(move - 1, 1)} (${figure(anchor.price * move)})`;
          });

          const bands = bandsBetween(edges);

          return {
            text: [
              `${listing} over ${counted(horizon, "session")} from ${anchor.date} at ${anchor.price}: ${moves.length} moves of that length in its daily bars since ${since}`,
              `Moves, each with the close it would make from ${anchor.price}: ${spread.join(", ")}`,
              ...(edges.length === 0
                ? []
                : rates
                  ? [
                      `Base rates: ${bands.map((band, index) => `${bandText(band.low, band.high)} ${Math.round(rates[index] * 100)}%`).join("; ")}`,
                    ]
                  : [
                      "Base rates: none, since the bars hold too few moves of that length to say.",
                    ]),
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
        async execute(draft, api) {
          const unread = await unreadQuotes(api, draft.symbol, [
            ...[...(draft.drivers ?? []), ...(draft.risks ?? [])].map(
              ({ text, quote }) => ({ about: text, quote })
            ),
            ...(draft.events ?? []).map(({ label, quote }) => ({
              about: label,
              quote,
            })),
          ]);

          if (unread.length > 0) {
            throw new Error(`The report was not kept.\n${unread.join("\n")}`);
          }

          const revision = await desk.revise(draft);

          if (!revision.ok) {
            throw new Error(
              `The report was not kept.\n${revision.violations.map(reportViolationText).join("\n")}`
            );
          }

          const { symbol, revision: number } = revision.report;

          return {
            text: `Kept revision ${number} of the ${symbolLabel(symbol)} report.`,
            details: { symbol, revision: number } satisfies ReviseReportDetails,
          };
        },
      }),

      defineTool({
        name: AgentToolName.SubmitForecast,
        // The forecast's id is kept with the call, so a call that runs again finds what it made.
        replay: "safe",
        description:
          "Puts a forecast for a listing on record under its report. The app anchors it on the newest daily bar, freezes it, and scores it once its horizon's session closes: the probabilities against the band the close lands in, and the plan against the bars, with every tie counted against the plan. The bars are judged on the anchor's terms, with what goes ex, splits or is reduced inside the horizon made up for from their reference prices, so set no band or level lower for an ex-dividend day or a split. One per listing per session. It is no order and reaches no broker.",
        parameters: forecastParameters,
        async execute(draft, api, context): Promise<ToolOutput> {
          const id = await api.memo(
            "forecast-id",
            crypto.randomUUID(),
            context
          );

          const unread = await unreadQuotes(
            api,
            draft.instrument,
            draft.claims.map(({ text, quote }) => ({ about: text, quote }))
          );

          if (unread.length > 0) {
            throw new Error(
              `The forecast was not kept. Fix these and submit again.\n${unread.join("\n")}`
            );
          }

          const magi = await options.magi?.(api.conversationId);

          const result = await desk.forecast(
            { ...draft, id },
            magi &&
              ((motion) =>
                magi.scenarios(
                  forecastMotion(motion),
                  motion.draft.scenarios.length,
                  durableScenarioBox(api, context)
                ))
          );

          const symbol = {
            market: draft.instrument.market,
            symbol: draft.instrument.symbol,
          };

          if (!result.ok) {
            throw new Error(
              `The forecast was not kept. Fix these and submit again.\n${result.violations
                .map((violation) => forecastViolationText(violation, draft))
                .join("\n")}`
            );
          }

          const { forecast } = result;

          return {
            text: [
              ...votedText(forecast, magi !== undefined),
              `Kept and frozen:\n${forecastText(forecast)}`,
            ].join("\n"),
            details: {
              symbol,
              forecastId: forecast.id,
            } satisfies SubmitForecastDetails,
          };
        },
      }),
    ],
  });
}
