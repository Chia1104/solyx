import { Chip, cn } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { Forecast, ForecastScenario } from "@solyx/core/forecast";
import type { SymbolRef } from "@solyx/core/market";

import { numberFormats } from "../market/number-formats.ts";

import { researchCoverageQuery } from "./research-query.ts";

function ScenarioRow({
  scenario,
  held,
}: {
  scenario: ForecastScenario;
  held: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { price } = numberFormats(i18n.language);
  const { low, high } = scenario;

  let band = t("research.forecast.band-between", {
    low: price.format(low ?? 0),
    high: price.format(high ?? 0),
  });

  if (low === null) {
    band = t("research.forecast.band-below", { high: price.format(high ?? 0) });
  } else if (high === null) {
    band = t("research.forecast.band-above", { low: price.format(low) });
  }

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className={cn("truncate", held && "font-semibold")}>
          {scenario.label}
        </span>
        <span className="shrink-0 text-xs text-muted">{band}</span>
        {held ? (
          <span className="shrink-0 text-xs text-accent">
            {t("research.forecast.held")}
          </span>
        ) : null}
      </span>
      <span className="tabular-nums">{scenario.probability}%</span>
      <span
        aria-hidden
        className="col-span-2 h-1 rounded-full bg-surface-secondary">
        <span
          className={cn(
            "block h-full rounded-full",
            held ? "bg-accent" : "bg-muted"
          )}
          style={{ width: `${scenario.probability}%` }}
        />
      </span>
    </li>
  );
}

function PlanLevel({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ForecastBody({ forecast }: { forecast: Forecast }) {
  const { t, i18n } = useTranslation();
  const { price, signedAmount } = numberFormats(i18n.language);
  const { anchor, plan, outcome } = forecast;

  return (
    // Pencil until it settles: a forecast is a claim about sessions that have not traded yet.
    <article
      className={cn(
        "flex flex-col gap-2.5 rounded-sm border border-separator p-3 text-sm",
        !outcome && "border-dashed"
      )}>
      <header className="flex items-center gap-2">
        <Chip size="sm">{t(`research.direction.${forecast.direction}`)}</Chip>
        <span className="min-w-0 truncate text-xs text-muted tabular-nums">
          {t("research.forecast.horizon", {
            count: forecast.horizon,
            date: anchor.date,
            price: price.format(anchor.price),
          })}
        </span>
        <span className="ml-auto shrink-0 text-xs text-muted">
          {t(outcome ? "research.forecast.settled" : "research.forecast.open")}
        </span>
      </header>
      {plan ? (
        <dl className="flex gap-4 text-xs tabular-nums">
          <PlanLevel
            label={t("research.forecast.entry")}
            value={price.format(plan.entry)}
          />
          <PlanLevel
            label={t("research.forecast.stop")}
            value={price.format(plan.stop)}
          />
          <PlanLevel
            label={t("research.forecast.target")}
            value={price.format(plan.target)}
          />
        </dl>
      ) : null}
      <ul className="flex flex-col gap-2">
        {forecast.scenarios.map((scenario, index) => (
          <ScenarioRow
            key={scenario.label}
            scenario={scenario}
            held={outcome?.scenario === index}
          />
        ))}
      </ul>
      {outcome ? (
        <p className="text-xs text-muted tabular-nums">
          {t("research.forecast.closed", {
            close: price.format(outcome.close),
            date: outcome.date,
          })}
          {outcome.plan ? (
            <>
              {" · "}
              {t(`research.forecast.plan-result.${outcome.plan.result}`)}
              {outcome.plan.r === null
                ? null
                : ` (${t("research.forecast.r", { r: signedAmount.format(outcome.plan.r) })})`}
            </>
          ) : null}
        </p>
      ) : null}
    </article>
  );
}

/** A forecast as the agent put it on record, and how it came out once its horizon closed. */
export function ForecastCard({
  symbol,
  id,
}: {
  symbol: SymbolRef;
  id: string;
}) {
  const { data } = useQuery(researchCoverageQuery(symbol));
  const forecast = data?.forecasts.find((candidate) => candidate.id === id);

  return forecast ? <ForecastBody forecast={forecast} /> : null;
}
