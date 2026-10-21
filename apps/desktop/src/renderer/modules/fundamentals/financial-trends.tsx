import type { ReactNode } from "react";

import { cn } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { useTranslation } from "react-i18next";

import type { StatementMetrics } from "@solyx/core/fundamentals";
import { currencyOf } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { cssPercent } from "@solyx/utils/format";

import { ChartMark } from "../../components/chart-mark.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LINE_COLORS } from "../market/chart-palette.ts";
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
              <li key={mark.key} className="relative h-full w-4 min-w-1 shrink">
                <ChartMark label={mark.title}>
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
                </ChartMark>
              </li>
            );
          })}
        </ol>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 h-px bg-border"
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

/** The margins drawn, from what is left after the cost of sales to what is left after everything. */
const MARGINS = [
  {
    key: "gross",
    of: (quarter: StatementMetrics) => quarter.grossMargin,
    color: LINE_COLORS.fast,
  },
  {
    key: "operating",
    of: (quarter: StatementMetrics) => quarter.operatingMargin,
    color: LINE_COLORS.slow,
  },
  {
    key: "net",
    of: (quarter: StatementMetrics) => quarter.netMargin,
    color: LINE_COLORS.oscillator,
  },
] as const;

/** Room above and below the lines, in hundredths of the plot. */
const INSET = 8;

/**
 * The gross, operating and net margins over the quarters on one scale, each a line in its own
 * colour, named with its newest figure. Pointing at a quarter marks it on every line and names
 * its three margins. Nothing is drawn while fewer than two quarters report one.
 */
function MarginLines({
  quarters,
}: {
  quarters: readonly (StatementMetrics & { period: string })[];
}) {
  const { t, i18n } = useTranslation();
  const { percent, fineShare } = numberFormats(i18n.language);

  const lines = MARGINS.map((margin) => ({
    ...margin,
    values: quarters.map(margin.of),
  })).filter(
    ({ values }) => values.filter((value) => value !== null).length >= 2
  );

  if (lines.length === 0) return null;

  const all = lines.flatMap(({ values }) =>
    values.filter((value) => value !== null)
  );

  const x = scaleLinear()
    .domain([0, quarters.length - 1])
    .range([0, 100]);

  const y = scaleLinear()
    .domain([Math.min(...all), Math.max(...all)])
    .range([100 - INSET, INSET]);

  // A quarter that reports no figure breaks the line rather than bridging it, so `y` never reads
  // the zero standing in for it.
  const path = line<number | null>()
    .defined((value) => value !== null)
    .x((_, index) => x(index))
    .y((value) => y(value ?? 0));

  const shown = (value: number | null) =>
    value === null ? "–" : fineShare.format(value);

  const last = quarters.length - 1;

  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <figcaption className="flex flex-col">
        <span className="truncate text-xs text-muted">
          {t("fundamentals.trends.margins")}
        </span>
        <span className="flex flex-wrap items-baseline gap-x-2 text-xs tabular-nums">
          {lines.map(({ key, color, values }) => (
            <span key={key} className="flex items-center gap-1">
              <i
                aria-hidden
                className="h-0.5 w-2.5 rounded-full"
                style={{ backgroundColor: color }}
              />
              {t(`fundamentals.trends.margin.${key}`)}{" "}
              {percent.format(values.at(-1) ?? 0)}
            </span>
          ))}
        </span>
      </figcaption>
      <div className="relative h-12">
        <svg
          aria-hidden
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible">
          {lines.map(({ key, color, values }) => (
            <path
              key={key}
              d={path(values) ?? undefined}
              fill="none"
              style={{ stroke: color }}
              strokeWidth={1.5}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {/* Each quarter's band reaches halfway to its neighbours' points, so the one pointed at is the nearest. */}
        <ol className="absolute inset-0 flex">
          {quarters.map((quarter, index) => {
            const end = index === 0 || index === last;
            // Where the quarter's point sits across its band.
            const at = index === 0 ? 0 : index === last ? 1 : 0.5;

            return (
              <li
                key={quarter.period}
                className="relative h-full basis-0"
                style={{ flexGrow: end ? 1 : 2 }}>
                <ChartMark
                  label={t("fundamentals.trends.mark", {
                    period: quarter.period,
                    figure: lines
                      .map(
                        ({ key, of }) =>
                          `${t(`fundamentals.trends.margin.${key}`)} ${shown(of(quarter))}`
                      )
                      .join(" · "),
                  })}
                  tooltip={
                    <>
                      <span className="font-medium">{quarter.period}</span>
                      {lines.map(({ key, color, of }) => (
                        <span key={key} className="flex items-center gap-1.5">
                          <i
                            aria-hidden
                            className="h-0.5 w-2.5 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                          <span className="text-muted">
                            {t(`fundamentals.trends.margin.${key}`)}
                          </span>
                          <span className="ml-auto pl-3">
                            {shown(of(quarter))}
                          </span>
                        </span>
                      ))}
                    </>
                  }
                  // Light enough that the lines show through the band.
                  className="hover:bg-default/40 focus-visible:bg-default/40">
                  {lines.map(({ key, color, values }) => {
                    const value = values[index];

                    return value === null ? null : (
                      <span
                        key={key}
                        className="absolute hidden size-1.5 -translate-1/2 rounded-full ring-2 ring-background group-hover/mark:block group-focus-visible/mark:block"
                        style={{
                          left: cssPercent(at),
                          top: cssPercent(y(value) / 100),
                          backgroundColor: color,
                        }}
                      />
                    );
                  })}
                </ChartMark>
              </li>
            );
          })}
        </ol>
      </div>
      <div
        aria-hidden
        className="flex justify-between gap-3 text-[10px] text-muted tabular-nums">
        <span>{quarters.at(0)?.period}</span>
        <span>{quarters.at(-1)?.period}</span>
      </div>
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
            <MarginLines quarters={quarters} />
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
