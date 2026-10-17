import type { ReactNode } from "react";

import { cn } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { currencyOf } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { cssPercent } from "@solyx/utils/format";

import { LoadError } from "../../components/load-error.tsx";
import { numberFormats } from "../market/number-formats.ts";

import { financialTrendsQuery } from "./fundamentals-query.ts";
import { columnScale, quarterOf } from "./trend-columns.ts";

/** One period on a tile: its figure and what hovering it says. */
interface TrendMark {
  key: string;
  figure: number | null;
  title: string;
}

/**
 * A figure over its periods, oldest first: the newest in ink, the rest in pencil, all on zero.
 * The plot is only as wide as its columns, so the periods named under it sit at its two ends.
 */
function TrendColumns({ marks }: { marks: readonly TrendMark[] }) {
  const { zero, columns } = columnScale(marks.map(({ figure }) => figure));

  return (
    <div className="flex w-fit max-w-full flex-col gap-1.5">
      <div className="relative h-12">
        <ol className="flex h-full gap-[3px]">
          {marks.map((mark, index) => {
            const place = columns[index];

            return (
              <li
                key={mark.key}
                title={mark.title}
                className="relative h-full w-4 min-w-1 shrink">
                {place ? (
                  <span
                    className={cn(
                      "absolute inset-x-0 min-h-px",
                      place.falls ? "rounded-b-[2px]" : "rounded-t-[2px]",
                      index === marks.length - 1 ? "bg-accent" : "bg-muted"
                    )}
                    style={{
                      top: cssPercent(place.top),
                      height: cssPercent(place.height),
                    }}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
        <span
          aria-hidden
          className="absolute inset-x-0 h-px bg-border"
          style={{ top: cssPercent(zero) }}
        />
      </div>
      <div
        aria-hidden
        className="flex justify-between gap-3 text-[10px] text-muted tabular-nums">
        <span>{marks.at(0)?.key}</span>
        <span>{marks.at(-1)?.key}</span>
      </div>
    </div>
  );
}

function Tile({
  label,
  figure,
  note,
  marks,
}: {
  label: string;
  /** The newest period's figure. */
  figure: string;
  /** What that figure is of or against. */
  note: ReactNode;
  marks: readonly TrendMark[];
}) {
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <figcaption className="flex flex-col">
        <span className="truncate text-xs text-muted">{label}</span>
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="font-medium">{figure}</span>
          <span className="text-xs text-muted tabular-nums">{note}</span>
        </span>
      </figcaption>
      <TrendColumns marks={marks} />
    </figure>
  );
}

/**
 * A listing's filed figures over its newest quarters and months, as the fundamentals module keeps
 * them. Nothing shows for a market no source covers or a listing that files none, as a fund does.
 */
export function FinancialTrends({ symbol }: { symbol: SymbolRef }) {
  const { t, i18n } = useTranslation();

  const { compactAmount, indicator, percentChange } = numberFormats(
    i18n.language
  );

  const { data, error, refetch } = useQuery(financialTrendsQuery(symbol));

  if (error) return <LoadError error={error} onRetry={() => void refetch()} />;

  if (!data) return null;

  const currency = currencyOf(symbol.market);

  const quarters = data.quarters.map((each) => {
    const period = t(
      "fundamentals.trends.quarter",
      quarterOf(each.statement.periodEnd)
    );

    return { ...each, period };
  });

  const newestQuarter = quarters.at(-1);
  const newestMonth = data.months.at(-1);

  const titled = (period: string, figure: string) =>
    t("fundamentals.trends.mark", { period, figure });

  const onYear = (change: number | null) =>
    change === null
      ? null
      : ` · ${t("fundamentals.trends.on-year", { change: percentChange.format(change) })}`;

  if (!newestQuarter && !newestMonth) return null;

  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-xs font-medium text-muted">
        {t("fundamentals.trends.title")}
      </h4>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-6 gap-y-4">
        {newestQuarter ? (
          <>
            <Tile
              label={t("fundamentals.trends.revenue", { currency })}
              figure={compactAmount.format(newestQuarter.statement.revenue)}
              note={
                <>
                  {newestQuarter.period}
                  {onYear(newestQuarter.revenueYoY)}
                </>
              }
              marks={quarters.map(({ period, statement }) => ({
                key: period,
                figure: statement.revenue,
                title: titled(period, compactAmount.format(statement.revenue)),
              }))}
            />
            {newestQuarter.statement.eps === null ? null : (
              <Tile
                label={t("fundamentals.trends.eps", { currency })}
                figure={indicator.format(newestQuarter.statement.eps)}
                note={
                  <>
                    {newestQuarter.period}
                    {onYear(newestQuarter.epsYoY)}
                  </>
                }
                marks={quarters.map(({ period, statement: { eps } }) => ({
                  key: period,
                  figure: eps,
                  title: titled(
                    period,
                    eps === null ? "–" : indicator.format(eps)
                  ),
                }))}
              />
            )}
          </>
        ) : null}
        {newestMonth && newestMonth.yoy !== null ? (
          <Tile
            label={t("fundamentals.trends.monthly")}
            figure={percentChange.format(newestMonth.yoy)}
            note={t("fundamentals.trends.month-revenue", {
              month: newestMonth.month,
              revenue: compactAmount.format(newestMonth.revenue),
            })}
            marks={data.months.map(({ month, yoy }) => ({
              key: month,
              figure: yoy,
              title: titled(
                month,
                yoy === null ? "–" : percentChange.format(yoy)
              ),
            }))}
          />
        ) : null}
      </div>
    </section>
  );
}
