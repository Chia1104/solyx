import { Button, cn } from "@heroui/react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { groupBy, mapValues, partition, sortBy, uniq } from "es-toolkit";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { EventTiming, ListingEventKind } from "@solyx/core/calendar";
import type {
  ListingEvent,
  ReleaseEvent,
  ResearchEvent,
} from "@solyx/core/calendar";
import { MacroUnit, macroReadings, releaseReadings } from "@solyx/core/macro";
import type { MacroRelease, MacroSeries } from "@solyx/core/macro";
import { exchangeDate, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { MarketClosure } from "@solyx/core/session";
import { shiftDate } from "@solyx/utils/date";

import { useClock } from "../../app/clock.ts";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Sparkline } from "../../components/sparkline.tsx";
import { macroSeriesQuery } from "../macro/macro-query.ts";
import { ListingName } from "../market/listing-name.tsx";
import { numberFormats } from "../market/number-formats.ts";

import { Agenda } from "./agenda.tsx";
import { CALENDAR_DAYS, upcomingEventsQuery } from "./calendar-query.ts";

/** What an event is, in words: the period a filing covers, a distribution's amount, or how long a restriction lasts and why. */
function EventLabel({ event }: { event: ListingEvent }) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  switch (event.kind) {
    case ListingEventKind.QuarterlyReport: {
      const end = Temporal.PlainDate.from(event.subject);

      return t("calendar.kinds.quarterly-report", {
        year: end.year,
        quarter: Math.ceil(end.month / 3),
      });
    }

    case ListingEventKind.MonthlyRevenue:
      return t("calendar.kinds.monthly-revenue", { month: event.subject });
    case ListingEventKind.ExDividend:
    case ListingEventKind.ExRights:
      // The exchange's notice may tell of the day before any amount is set.
      return event.amount === null
        ? t(`calendar.noticed.${event.kind}`)
        : t(`calendar.kinds.${event.kind}`, {
            amount: format.price.format(event.amount),
          });
    case ListingEventKind.DividendPayment:
      return t("calendar.kinds.dividend-payment", {
        amount: format.price.format(event.amount ?? 0),
      });
    default: {
      const detail = [
        event.until === null
          ? null
          : t("calendar.until", { date: event.until.slice("YYYY-".length) }),
        event.subject || null,
      ].filter((part) => part !== null);

      return (
        <>
          {t(`calendar.kinds.${event.kind}`)}
          {detail.length === 0 ? null : (
            <span className="ms-1.5 text-xs text-muted">
              {detail.join(" · ")}
            </span>
          )}
        </>
      );
    }
  }
}

const ROW_CLASS =
  "grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 py-2 text-sm @min-[40rem]/main:grid-cols-[4.5rem_minmax(0,14rem)_minmax(0,1fr)]";

const WHAT_PLACE = "col-start-2 min-w-0 @min-[40rem]/main:col-start-3";

const WHAT_CLASS = `${WHAT_PLACE} truncate`;

/** An event's day as its timing reads: the latest it may come for a deadline, about then for an expected one. */
export function timedDay(
  t: TFunction,
  date: string,
  timing: EventTiming
): string {
  switch (timing) {
    case EventTiming.Set:
      return date;
    case EventTiming.Deadline:
      return t("calendar.by", { date });
    case EventTiming.Expected:
      return t("calendar.around", { date });
  }
}

/** An event's day, which `hint` explains unless whoever holds the event set it. */
function EventDay({
  date,
  timing,
  hint,
}: {
  date: string;
  timing: EventTiming;
  hint: string;
}) {
  const { t } = useTranslation();
  const set = timing === EventTiming.Set;

  return (
    <span
      className={cn("text-xs tabular-nums", !set && "text-muted")}
      title={set ? undefined : hint}>
      {timedDay(t, date.slice("YYYY-".length), timing)}
    </span>
  );
}

function EventRow({ event }: { event: ListingEvent }) {
  const { t } = useTranslation();
  const deadline = event.timing === EventTiming.Deadline;

  return (
    <li className={ROW_CLASS}>
      <EventDay
        date={event.date}
        timing={event.timing}
        hint={t("calendar.deadline-hint")}
      />
      <Link
        to="/symbol/$market/$symbol"
        params={event.symbol}
        className="flex min-w-0 items-baseline gap-1.5 hover:underline">
        <span className="shrink-0 font-medium">{event.symbol.symbol}</span>
        <ListingName symbol={event.symbol} className="text-xs text-muted" />
      </Link>
      <span className={cn(WHAT_CLASS, deadline && "text-muted")}>
        <EventLabel event={event} />
      </span>
    </li>
  );
}

/** A date a listing's report holds, marked as the agent's finding and showing its source on hover. */
function ResearchRow({ event }: { event: ResearchEvent }) {
  const { t } = useTranslation();

  return (
    <li className={ROW_CLASS}>
      <EventDay
        date={event.date}
        timing={event.timing}
        hint={t(`calendar.report-hints.${event.timing}`)}
      />
      <Link
        to="/symbol/$market/$symbol"
        params={event.symbol}
        className="flex min-w-0 items-baseline gap-1.5 hover:underline">
        <span className="shrink-0 font-medium">{event.symbol.symbol}</span>
        <ListingName symbol={event.symbol} className="text-xs text-muted" />
      </Link>
      <span
        className={cn(
          WHAT_CLASS,
          event.timing !== EventTiming.Set && "text-muted"
        )}
        title={`${event.source} — “${event.quote}”`}>
        {event.label}
        <span className="ms-1.5 text-xs text-muted">
          {t("calendar.from-report")}
        </span>
      </span>
    </li>
  );
}

/** Two years of monthly figures. */
const TREND_PERIODS = 24;

/**
 * A release's headline figure period by period up to the one it reads, the newest
 * `TREND_PERIODS`: its growth on a year before where the figure grows, as an index or an amount
 * does, else its level, as a rate's.
 */
function figureTrend(release: ReleaseEvent, series: readonly MacroSeries[]) {
  const [reading] = release.readings;

  const figure =
    reading &&
    series.find(
      (each) =>
        each.market === release.market &&
        each.indicator === release.indicator &&
        each.figure === reading.figure
    );

  if (!reading || !figure) return null;

  const readings = macroReadings(figure).filter(
    ({ period }) => period <= reading.period
  );

  const grows = readings.some(({ yoy }) => yoy !== null);

  return {
    grows,
    points: readings
      .flatMap(({ period, value, yoy }) => {
        const shown = grows ? yoy : value;

        return shown === null ? [] : [{ period, value: shown }];
      })
      .slice(-TREND_PERIODS),
  };
}

/**
 * A release's headline figure in words, what it brought once its period is out or else the newest
 * out before it, with how it has gone the periods before, while its market's figures are still
 * being read.
 */
function ReleaseFigure({
  release,
  series,
  pending,
}: {
  release: ReleaseEvent;
  series: readonly MacroSeries[];
  pending: boolean;
}) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);
  const [reading] = release.readings;

  if (pending) {
    return (
      <span className="ms-1.5 text-xs text-muted">
        {t("calendar.reading.pending")}
      </span>
    );
  }

  if (!reading) return null;

  const value = {
    [MacroUnit.Index]: () => format.indicator.format(reading.value),
    [MacroUnit.UsdMillions]: () =>
      format.compactUsd.format(reading.value * 1e6),
    [MacroUnit.Points]: () => format.indicator.format(reading.value),
    [MacroUnit.Percent]: () => format.percentChange.format(reading.value / 100),
  }[reading.unit]();

  const figure = t(`calendar.figures.${reading.figure}`, {
    value,
    yoy:
      reading.yoy === null
        ? t("calendar.no-figure")
        : format.percentChange.format(reading.yoy),
  });

  const trend = figureTrend(release, series);
  const first = trend?.points.at(0);
  const last = trend?.points.at(-1);

  return (
    <>
      <span className="ms-1.5 text-xs tabular-nums">
        {reading.period === release.period
          ? t("calendar.reading.out", { figure })
          : t("calendar.reading.last", { period: reading.period, figure })}
      </span>
      {trend && first && last && trend.points.length >= 3 ? (
        <span
          title={t(
            trend.grows
              ? "calendar.reading.trend-growth"
              : "calendar.reading.trend",
            { from: first.period, to: last.period }
          )}
          className="ms-2 inline-block h-3.5 w-14 align-middle">
          <Sparkline
            points={trend.points.map(({ value }, index) => ({
              time: index,
              value,
            }))}
            from={0}
            to={trend.points.length - 1}
            baseline={trend.grows ? 0 : null}
            color="var(--muted)"
            className="size-full"
          />
        </span>
      ) : null}
    </>
  );
}

const releaseKey = ({ market, indicator, date, period }: MacroRelease) =>
  `${market}:${indicator}:${date}:${period}`;

function ReleaseRow({
  release,
  series,
  pending,
}: {
  release: ReleaseEvent;
  series: readonly MacroSeries[];
  pending: boolean;
}) {
  const { t } = useTranslation();

  return (
    <li className={ROW_CLASS}>
      <EventDay
        date={release.date}
        timing={release.timing}
        hint={t("calendar.release-deadline-hint")}
      />
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 font-medium">
          {t(`market.${release.market}`)}
        </span>
        <span className="text-xs text-muted">{t("calendar.economy")}</span>
      </span>
      {/* A release's figure says more than a line holds in a narrow pane, so it wraps rather than cuts off. */}
      <span
        className={cn(
          WHAT_PLACE,
          release.timing === EventTiming.Deadline && "text-muted"
        )}>
        {release.page === null ? (
          t(`calendar.indicators.${release.indicator}`)
        ) : (
          <a
            href={release.page}
            target="_blank"
            rel="noreferrer"
            title={t("calendar.release-page")}
            className="hover:underline">
            {t(`calendar.indicators.${release.indicator}`)}
          </a>
        )}
        <span className="ms-1.5 text-xs text-muted tabular-nums">
          {[release.period, release.time]
            .filter((part) => part !== null)
            .join(" · ")}
        </span>
        <ReleaseFigure release={release} series={series} pending={pending} />
      </span>
    </li>
  );
}

/** A weekday a market is closed, with what its exchange calls the day. */
function ClosureRow({ closure }: { closure: MarketClosure }) {
  const { t } = useTranslation();

  return (
    <li className={ROW_CLASS}>
      <EventDay
        date={closure.date}
        timing={EventTiming.Set}
        hint={t("calendar.closed")}
      />
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 font-medium">
          {t(`market.${closure.market}`)}
        </span>
        <span className="text-xs text-muted">{t("calendar.exchange")}</span>
      </span>
      <span className={WHAT_CLASS}>
        {t("calendar.closed")}
        <span className="ms-1.5 text-xs text-muted">{closure.name}</span>
      </span>
    </li>
  );
}

/**
 * The listings' coming filings and distributions, the dates their reports hold and their markets'
 * economic releases and closures, on an agenda that shows a week or a month of them soonest
 * first, with the listings and markets whose dates could not be read. The releases whose day has
 * come stay above it for a while, newest first, so the figures they brought are read at a glance.
 * Each market's figures are read apart from the dates, which show while they are still coming.
 */
export function UpcomingEvents({ symbols }: { symbols: SymbolRef[] }) {
  const { t } = useTranslation();
  const clock = useClock();
  const { data, error, refetch } = useQuery(upcomingEventsQuery(symbols));
  const markets = uniq(symbols.map(({ market }) => market));

  const figures = useQueries({
    queries: markets.map((market) => macroSeriesQuery(market)),
  });

  if (error) return <LoadError error={error} onRetry={() => void refetch()} />;

  if (!data) return <LoadingState />;

  const today = Temporal.Now.plainDateISO(clock.timeZone).toString();

  // An event's day is its exchange's, so the agenda opens on the earliest day still running on any.
  const running = [
    today,
    ...markets.map((market) => exchangeDate(market)),
  ].toSorted();

  const series = figures.flatMap(({ data: read }) => read ?? []);

  const pending = new Set(
    markets.filter((_, index) => figures[index]?.isPending)
  );

  const unreadFigures = markets.filter((_, index) => figures[index]?.isError);

  // A release whose day is behind every calendar in view is out, and no longer ahead on the agenda.
  const [ahead, released] = partition(
    data.releases.map((release): ReleaseEvent => ({
      ...release,
      readings: releaseReadings(release, series),
    })),
    ({ date }) => date >= (running.at(0) ?? today)
  );

  const rows = sortBy(
    [
      ...data.events.map((event) => ({
        date: event.date,
        timing: event.timing,
        row: (
          <EventRow
            key={`${symbolKey(event.symbol)}:${event.kind}:${event.date}:${event.subject}`}
            event={event}
          />
        ),
      })),
      ...data.research.map((event) => ({
        date: event.date,
        timing: event.timing,
        row: (
          <ResearchRow
            key={`${symbolKey(event.symbol)}:report:${event.date}:${event.label}`}
            event={event}
          />
        ),
      })),
      ...data.closures.map((closure) => ({
        date: closure.date,
        timing: EventTiming.Set,
        row: (
          <ClosureRow
            key={`${closure.market}:closed:${closure.date}`}
            closure={closure}
          />
        ),
      })),
      ...ahead.map((release) => ({
        date: release.date,
        timing: release.timing,
        row: (
          <ReleaseRow
            key={releaseKey(release)}
            release={release}
            series={series}
            pending={pending.has(release.market)}
          />
        ),
      })),
    ],
    [({ date }) => date]
  );

  const marks = new Map(
    Object.entries(
      mapValues(
        groupBy(rows, ({ date }) => date),
        (day) => {
          const inked = day.filter(
            ({ timing }) => timing === EventTiming.Set
          ).length;

          return { inked, pencilled: day.length - inked };
        }
      )
    )
  );

  return (
    <div className="flex flex-col gap-2">
      {released.length === 0 ? null : (
        <section className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-muted">
            {t("calendar.released")}
          </h3>
          <ul className="divide-y divide-separator">
            {released.toReversed().map((release) => (
              <ReleaseRow
                key={releaseKey(release)}
                release={release}
                series={series}
                pending={pending.has(release.market)}
              />
            ))}
          </ul>
        </section>
      )}
      {rows.length === 0 ? (
        <p className="rounded-sm pencil px-3 py-3 text-xs text-muted">
          {t("calendar.empty", { days: CALENDAR_DAYS })}
        </p>
      ) : (
        <Agenda
          from={running.at(0) ?? today}
          to={shiftDate(running.at(-1) ?? today, CALENDAR_DAYS)}
          today={today}
          marks={marks}>
          {({ from, to, show }) => {
            const shown = rows.filter(({ date }) => date >= from && date <= to);

            if (shown.length > 0) {
              return (
                <ul className="divide-y divide-separator">
                  {shown.map(({ row }) => row)}
                </ul>
              );
            }

            const next = rows.find(({ date }) => date > to);

            return (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1 text-xs text-muted">
                {t(from === to ? "calendar.empty-day" : "calendar.empty-span")}
                {next ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() => show(next.date)}>
                    {t("calendar.next-date", {
                      date: next.date.slice("YYYY-".length),
                    })}
                  </Button>
                ) : null}
              </div>
            );
          }}
        </Agenda>
      )}
      {data.unread.length === 0 ? null : (
        <p className="text-xs text-warning">
          {t("calendar.unread", {
            symbols: data.unread.map(({ symbol }) => symbol).join(", "),
          })}
        </p>
      )}
      {unreadFigures.length === 0 ? null : (
        <p className="text-xs text-warning">
          {t("calendar.figures-unread", {
            markets: unreadFigures
              .map((market) => t(`market.${market}`))
              .join(", "),
          })}
        </p>
      )}
      {data.unreadMarkets.length === 0 ? null : (
        <p className="text-xs text-warning">
          {t("calendar.schedule-unread", {
            markets: data.unreadMarkets
              .map((market) => t(`market.${market}`))
              .join(", "),
          })}
        </p>
      )}
    </div>
  );
}
