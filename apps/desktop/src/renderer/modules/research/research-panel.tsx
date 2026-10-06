import type { ReactNode } from "react";

import { Button, Chip } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { ForecastRecord } from "@solyx/core/forecast";
import { exchangeDate } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { ReportSection } from "@solyx/core/report";
import type { AuditedClaim, Report } from "@solyx/core/report";
import type { Coverage } from "@solyx/core/research";

import { Pane, useLayoutStore } from "../../app/layout-store.ts";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { useAgentStore } from "../agent/agent-store.ts";
import { numberFormats } from "../market/number-formats.ts";

import { ForecastBody } from "./forecast-card.tsx";
import { researchCoverageQuery } from "./research-query.ts";

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

function Claims({ title, claims }: { title: string; claims: AuditedClaim[] }) {
  const { t, i18n } = useTranslation();
  const { percent } = numberFormats(i18n.language);

  return claims.length === 0 ? null : (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium text-muted">{title}</h4>
      <ul className="flex flex-col gap-2">
        {claims.map((claim) => (
          <li key={claim.text} className="flex flex-col gap-0.5">
            <span>{claim.text}</span>
            <span className="text-xs break-words text-muted">
              {claim.source} — “{claim.quote}”
            </span>
            <span className="text-xs text-muted tabular-nums">
              {claim.support
                ? t("research.report.quote-read", {
                    share: percent.format(claim.support.supported),
                    model: claim.support.model,
                  })
                : t("research.report.quote-unread")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReportView({
  report,
  newerFinancials,
}: {
  report: Report;
  /** The last day of a quarter published since the report was revised, if one was. */
  newerFinancials: string | null;
}) {
  const { t, i18n } = useTranslation();
  const { price } = numberFormats(i18n.language);
  const { market } = report.symbol;
  const day = (at: number) => exchangeDate(market, new Date(at));

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
          <ul className="list-disc pl-4">
            {report.falsifiers.map((falsifier) => (
              <li key={falsifier}>{falsifier}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {report.valuation ? (
        <p>
          <span className="tabular-nums">
            {t("research.report.valuation", {
              low: price.format(report.valuation.low),
              high: price.format(report.valuation.high),
            })}
          </span>
          <span className="text-muted"> · {report.valuation.basis}</span>
        </p>
      ) : null}
      {report.events.length > 0 ? (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-xs font-medium text-muted">
            {t("research.report.events")}
          </h4>
          <ul className="flex flex-col gap-0.5">
            {report.events.map((event) => (
              <li key={`${event.date}:${event.label}`} className="flex gap-2">
                <span className="shrink-0 text-muted tabular-nums">
                  {event.date}
                </span>
                <span>{event.label}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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
  const { indicator, signedAmount } = numberFormats(i18n.language);

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
      {record.meanR === null
        ? null
        : ` · ${t("research.forecasts.mean-r", { r: signedAmount.format(record.meanR) })}`}
    </>
  );
}

function CoverageView({ coverage }: { coverage: Coverage }) {
  const { t } = useTranslation();
  const { report, newerFinancials, forecasts, record } = coverage;

  if (!report && forecasts.length === 0) {
    return (
      <p className="px-6 py-4 text-sm text-muted">{t("research.empty")}</p>
    );
  }

  return (
    // Side by side where the main view is wide; narrower, the forecasts follow the report.
    <div className="grid gap-6 px-6 py-4 @min-[56rem]/main:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      {report ? (
        <ReportView report={report} newerFinancials={newerFinancials} />
      ) : (
        <p className="text-sm text-muted">{t("research.report.none")}</p>
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
    body = <CoverageView coverage={data} />;
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
