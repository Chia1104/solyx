import type { ReactNode } from "react";

import { Button, Chip } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { SettingsSection } from "@solyx/api/settings-section";
import type { ForecastRecord } from "@solyx/core/forecast";
import { BENCHMARK, exchangeDate } from "@solyx/core/market";
import type { Market, SymbolRef } from "@solyx/core/market";
import { ReportSection } from "@solyx/core/report";
import type {
  Argument,
  Audited,
  ClaimSupport,
  Report,
  ReportEvent,
  StanceSpell,
} from "@solyx/core/report";
import { FALSIFIER_FLOORS } from "@solyx/core/research";
import type {
  Coverage,
  FalsifierCheck,
  FalsifierWatch,
} from "@solyx/core/research";

import { useClock } from "../../app/clock.ts";
import { Pane, useLayoutStore } from "../../app/layout-store.ts";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { useAgentStore } from "../agent/agent-store.ts";
import { timedDay } from "../calendar/upcoming-events.tsx";
import { FinancialTrends } from "../fundamentals/financial-trends.tsx";
import { ListingRotation } from "../market/listing-rotation.tsx";
import { numberFormats } from "../market/number-formats.ts";
import { PublishedTime } from "../news/news-list.tsx";
import { useDecisionsReady } from "../settings/settings-query.ts";

import { CalibrationChart } from "./calibration-chart.tsx";
import { ForecastBody } from "./forecast-card.tsx";
import { ForecastStrip } from "./forecast-strip.tsx";
import { researchCoverageQuery } from "./research-query.ts";
import { StanceHistory } from "./stance-history.tsx";
import { ValuationRange } from "./valuation-range.tsx";

/** Hands the agent's composer a request for a deep analysis, in a new conversation the user sends. */
function DeepAnalysisButton({ symbol }: { symbol: SymbolRef }) {
  const { t } = useTranslation();
  const select = useAgentStore((state) => state.select);
  const setDraft = useAgentStore((state) => state.setDraft);
  const agentOpen = useLayoutStore((state) => state.panes[Pane.Agent].open);
  const toggle = useLayoutStore((state) => state.toggle);

  return (
    <Button
      size="sm"
      variant="secondary"
      onPress={() => {
        if (!agentOpen) toggle(Pane.Agent);

        select(null);
        setDraft(t("research.deep-analysis-prompt", { symbol: symbol.symbol }));
      }}>
      {t("research.deep-analysis")}
    </Button>
  );
}

/** How a decisions model read a fact against its quote; an unread one says so only while one is set up. */
function QuoteReading({ support }: { support: ClaimSupport | null }) {
  const { t, i18n } = useTranslation();
  const { percent } = numberFormats(i18n.language);
  const audited = useDecisionsReady();

  return support || audited ? (
    <span className="text-xs text-muted tabular-nums">
      {support
        ? t("research.report.quote-read", {
            share: percent.format(support.supported),
            model: support.model,
          })
        : t("research.report.quote-unread")}
    </span>
  ) : null;
}

/** Each point over the fact it rests on, the source's own words, and how the fact was read against them. */
function Claims({
  title,
  claims,
}: {
  title: string;
  claims: Audited<Argument>[];
}) {
  return claims.length === 0 ? null : (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium text-muted">{title}</h4>
      <ul className="flex flex-col gap-2">
        {claims.map((claim) => (
          <li key={claim.text} className="flex flex-col gap-0.5">
            <span>{claim.point}</span>
            <span className="text-muted">{claim.text}</span>
            <span className="text-xs break-words text-muted">
              {claim.source} — “{claim.quote}”
            </span>
            <QuoteReading support={claim.support} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A falsifier, over the news a decisions model read as stating that it happened. */
function Falsifier({
  falsifier,
  market,
  signals,
}: {
  falsifier: string;
  market: Market;
  signals: FalsifierCheck[];
}) {
  const { t, i18n } = useTranslation();
  const { percent } = numberFormats(i18n.language);

  return (
    <li className="flex flex-col gap-1">
      <span>{falsifier}</span>
      {signals.map(({ source, item, support }) => (
        <span
          key={`${source}:${item.id}`}
          className="rounded-sm border border-dashed border-separator px-2 py-1 text-xs text-muted">
          {t("research.report.falsifier-stated", {
            share: percent.format(support.supported),
          })}{" "}
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="text-foreground hover:underline">
              {item.title}
            </a>
          ) : (
            <span className="text-foreground">{item.title}</span>
          )}{" "}
          <span className="tabular-nums">
            · {item.site} ·{" "}
            <PublishedTime market={market} published={item.published} />
          </span>
        </span>
      ))}
    </li>
  );
}

/** Whether the news is read against the falsifiers, so a quiet report is not taken for an unread one. */
function WatchStatus({
  watch: { gaps, pass },
  quiet,
}: {
  watch: FalsifierWatch;
  /** No item has read as stating a falsifier. */
  quiet: boolean;
}) {
  const { t } = useTranslation();
  const clock = useClock();

  if (gaps.length > 0) {
    return (
      <p className="rounded-sm border border-dashed border-separator px-3 py-2 text-xs text-muted">
        {[
          t("research.watch.off"),
          ...gaps.map((gap) =>
            t(`research.watch.gaps.${gap}`, {
              models: [...FALSIFIER_FLOORS.keys()].join(", "),
            })
          ),
        ].join(" ")}{" "}
        <Link
          to="/settings"
          search={{ section: SettingsSection.Agent }}
          className="text-foreground underline">
          {t("research.watch.settings")}
        </Link>
      </p>
    );
  }

  let status = t("research.watch.pending");

  if (pass?.failure != null) {
    status = t("research.watch.failed", {
      time: clock.time(pass.at),
      failure: pass.failure,
    });
  } else if (pass) {
    status = [
      t("research.watch.read", {
        count: pass.items,
        time: clock.time(pass.at),
      }),
      ...(quiet ? [t("research.watch.quiet")] : []),
      ...(pass.unread > 0
        ? [t("research.watch.unread", { count: pass.unread })]
        : []),
    ].join(" ");
  }

  return <p className="text-xs text-muted tabular-nums">{status}</p>;
}

/**
 * The dates a report holds, each over the source's own words for it; one whose day has passed
 * waits for the revision that says what came of it.
 */
function Events({
  events,
  passed,
}: {
  events: Audited<ReportEvent>[];
  passed: Audited<ReportEvent>[];
}) {
  const { t } = useTranslation();
  const eventKey = ({ date, label }: ReportEvent) => `${date}:${label}`;
  const behind = new Set(passed.map(eventKey));

  return events.length === 0 ? null : (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium text-muted">
        {t("research.report.events")}
      </h4>
      <ul className="flex flex-col gap-2">
        {events.map((event) => (
          <li key={eventKey(event)} className="flex flex-col gap-0.5">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="shrink-0 text-muted tabular-nums">
                {timedDay(t, event.date, event.timing)}
              </span>
              <span>{event.label}</span>
              {behind.has(eventKey(event)) ? (
                <span className="text-xs text-warning">
                  {t("research.report.event-passed")}
                </span>
              ) : null}
            </span>
            <span className="text-xs break-words text-muted">
              {event.source} — “{event.quote}”
            </span>
            <QuoteReading support={event.support} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReportView({
  report,
  newerFinancials,
  passedEvents,
  signals,
  watch,
  stances,
}: {
  report: Report;
  /** The last day of a quarter published since the report was revised, if one was. */
  newerFinancials: string | null;
  passedEvents: Audited<ReportEvent>[];
  signals: FalsifierCheck[];
  watch: FalsifierWatch | null;
  /** Each stretch the report kept one stance, against its market's index; none while they cannot be measured. */
  stances: StanceSpell[];
}) {
  const { t, i18n } = useTranslation();
  const { percentChange } = numberFormats(i18n.language);
  const { market } = report.symbol;
  const day = (at: number) => exchangeDate(market, new Date(at));
  const standing = stances.findLast(({ until }) => until === null);

  return (
    <article className="flex flex-col gap-4 text-sm">
      <header className="flex items-center gap-2">
        <Chip size="sm">{t(`research.stance.${report.stance}`)}</Chip>
        <span className="text-xs text-muted tabular-nums">
          {t("research.report.revision", {
            revision: report.revision,
            date: day(report.revisedAt),
          })}
        </span>
      </header>
      {standing ? (
        <p className="text-xs text-muted tabular-nums">
          {t("research.report.stance-since", {
            date: standing.from,
            count: standing.sessions,
            change: percentChange.format(standing.change),
            benchmark: percentChange.format(standing.benchmark),
            index: BENCHMARK[market].name,
          })}
        </p>
      ) : null}
      <StanceHistory market={market} spells={stances} />
      {newerFinancials ? (
        <p className="rounded-sm border border-dashed border-separator px-3 py-2 text-xs text-muted">
          {t("research.report.stale", { date: newerFinancials })}
        </p>
      ) : null}
      <p>{report.thesis}</p>
      <Claims title={t("research.report.drivers")} claims={report.drivers} />
      <Claims title={t("research.report.risks")} claims={report.risks} />
      {report.falsifiers.length > 0 ? (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-xs font-medium text-muted">
            {t("research.report.falsifiers")}
          </h4>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {report.falsifiers.map((falsifier) => (
              <Falsifier
                key={falsifier}
                falsifier={falsifier}
                market={market}
                signals={signals.filter(
                  (signal) => signal.falsifier === falsifier
                )}
              />
            ))}
          </ul>
          {watch ? (
            <WatchStatus watch={watch} quiet={signals.length === 0} />
          ) : null}
        </section>
      ) : null}
      {report.valuation ? (
        <ValuationRange symbol={report.symbol} valuation={report.valuation} />
      ) : null}
      <FinancialTrends symbol={report.symbol} />
      <Events events={report.events} passed={passedEvents} />
      {Object.values(ReportSection).map((section) => {
        const part = report.sections[section];

        return part ? (
          <section key={section} className="flex flex-col gap-1.5">
            <h4 className="flex items-baseline gap-2 text-xs font-medium text-muted">
              {t(`research.sections.${section}`)}
              <span className="font-normal tabular-nums">
                {t("research.report.written", { date: day(part.revisedAt) })}
              </span>
            </h4>
            <p className="whitespace-pre-wrap">{part.text}</p>
          </section>
        ) : null;
      })}
    </article>
  );
}

function RecordLine({ record }: { record: ForecastRecord }) {
  const { t, i18n } = useTranslation();

  const { indicator, signedAmount, percentChange } = numberFormats(
    i18n.language
  );

  const skill = record.skill?.skill ?? null;

  if (record.brier === null) {
    return t("research.forecasts.record-open", { count: record.forecasts });
  }

  return (
    <>
      {t("research.forecasts.record", {
        count: record.forecasts,
        settled: record.settled,
        brier: indicator.format(record.brier),
      })}
      {skill === null
        ? null
        : ` · ${t("research.forecasts.skill", { skill: percentChange.format(skill) })}`}
      {record.meanR === null
        ? null
        : ` · ${t("research.forecasts.mean-r", { r: signedAmount.format(record.meanR) })}`}
      {record.motions
        ? ` · ${t("research.forecasts.motions", {
            held: record.motions.held,
            calls: record.motions.calls,
            expected: indicator.format(record.motions.expected),
          })}`
        : null}
      {record.evidence
        ? ` · ${t("research.forecasts.evidence", {
            held: record.evidence.held,
            calls: record.evidence.calls,
            expected: indicator.format(record.evidence.expected),
          })}`
        : null}
    </>
  );
}

function CoverageView({
  symbol,
  coverage,
}: {
  symbol: SymbolRef;
  coverage: Coverage;
}) {
  const { t } = useTranslation();

  const {
    report,
    newerFinancials,
    passedEvents,
    forecasts,
    record,
    signals,
    watch,
    stances,
  } = coverage;

  // A listing's filings are the app's to show whether or not the agent has written of it.
  if (!report && forecasts.length === 0) {
    return (
      <div className="flex flex-col gap-4 px-6 py-4 text-sm">
        <p className="text-muted">{t("research.empty")}</p>
        <ListingRotation symbol={symbol} />
        <FinancialTrends symbol={symbol} />
      </div>
    );
  }

  return (
    // Side by side where the main view is wide; narrower, the forecasts follow the report.
    <div className="grid gap-6 px-6 py-4 @min-[56rem]/main:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="@min-[56rem]/main:col-span-2">
        <ListingRotation symbol={symbol} />
      </div>
      {report ? (
        <ReportView
          report={report}
          newerFinancials={newerFinancials}
          passedEvents={passedEvents}
          signals={signals}
          watch={watch}
          stances={stances}
        />
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-muted">{t("research.report.none")}</p>
          <FinancialTrends symbol={symbol} />
        </div>
      )}
      <section className="flex flex-col gap-3">
        <h3 className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
          {t("research.forecasts.title")}
          {forecasts.length > 0 ? (
            <span className="text-xs font-normal text-muted tabular-nums">
              <RecordLine record={record} />
            </span>
          ) : null}
        </h3>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
          <div className="min-w-0 flex-[1_1_16rem]">
            <ForecastStrip forecasts={forecasts} />
          </div>
          <CalibrationChart buckets={record.calibration} />
        </div>
        {forecasts.length === 0 ? (
          <p className="text-sm text-muted">{t("research.forecasts.none")}</p>
        ) : (
          forecasts.toReversed().map((forecast) => (
            <div key={forecast.id} className="flex flex-col gap-1.5">
              <ForecastBody forecast={forecast} />
              <p className="text-xs text-muted">{forecast.rationale}</p>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

/**
 * What the agent holds of a listing: its report beside its forecasts, newest first, with how they
 * have come out, filling the height it is given under a header that starts a deep analysis.
 */
export function ResearchPanel({
  symbol,
  heading,
}: {
  symbol: SymbolRef;
  /** What leads the header row, such as the switch between this and the news. */
  heading: ReactNode;
}) {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(researchCoverageQuery(symbol));

  let body = <LoadingState />;

  if (error) {
    body = (
      <div className="px-6 py-4">
        <LoadError error={error} onRetry={() => void refetch()} />
      </div>
    );
  } else if (data) {
    body = <CoverageView symbol={symbol} coverage={data} />;
  }

  return (
    <section
      aria-label={t("research.title")}
      className="flex h-full flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-separator px-6">
        {heading}
        <div className="ml-auto flex">
          <DeepAnalysisButton symbol={symbol} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </section>
  );
}
