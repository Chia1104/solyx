import { Button, cn } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { groupBy, mapValues, sortBy, uniq } from "es-toolkit";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { EventTiming, ListingEventKind } from "@solyx/core/calendar";
import type { ListingEvent, ResearchEvent } from "@solyx/core/calendar";
import type { MacroRelease } from "@solyx/core/macro";
import { exchangeDate, shiftDate, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { useClock } from "../../app/clock.ts";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
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
    case ListingEventKind.DividendPayment:
      return t(`calendar.kinds.${event.kind}`, {
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

const WHAT_CLASS = "col-start-2 min-w-0 truncate @min-[40rem]/main:col-start-3";

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

function ReleaseRow({ release }: { release: MacroRelease }) {
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
      <span
        className={cn(
          WHAT_CLASS,
          release.timing === EventTiming.Deadline && "text-muted"
        )}>
        {t(`calendar.indicators.${release.indicator}`)}
        {release.period === null ? null : (
          <span className="ms-1.5 text-xs text-muted tabular-nums">
            {release.period}
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * The listings' coming filings and distributions, the dates their reports hold and their markets'
 * economic releases, on an agenda that shows a week or a month of them soonest first, with the
 * listings and markets whose dates could not be read.
 */
export function UpcomingEvents({ symbols }: { symbols: SymbolRef[] }) {
  const { t } = useTranslation();
  const clock = useClock();
  const { data, error, refetch } = useQuery(upcomingEventsQuery(symbols));

  if (error) return <LoadError error={error} onRetry={() => void refetch()} />;

  if (!data) return <LoadingState />;

  const today = Temporal.Now.plainDateISO(clock.timeZone).toString();

  // An event's day is its exchange's, so the agenda opens on the earliest day still running on any.
  const running = [
    today,
    ...uniq(symbols.map(({ market }) => market)).map((market) =>
      exchangeDate(market)
    ),
  ].toSorted();

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
      ...data.releases.map((release) => ({
        date: release.date,
        timing: release.timing,
        row: (
          <ReleaseRow
            key={`${release.market}:${release.indicator}:${release.date}:${release.period}`}
            release={release}
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
