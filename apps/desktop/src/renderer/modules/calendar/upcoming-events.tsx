import { cn } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { sortBy } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { EventTiming, ListingEventKind } from "@solyx/core/calendar";
import type { ListingEvent } from "@solyx/core/calendar";
import type { MacroRelease } from "@solyx/core/macro";
import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { ListingName } from "../market/listing-name.tsx";
import { numberFormats } from "../market/number-formats.ts";

import { CALENDAR_DAYS, upcomingEventsQuery } from "./calendar-query.ts";

/** What an event is, in words: the period a filing covers, or a distribution's amount. */
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
    default:
      return t(`calendar.kinds.${event.kind}`, {
        amount: format.price.format(event.amount ?? 0),
      });
  }
}

const ROW_CLASS =
  "grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 py-2 text-sm @min-[40rem]/main:grid-cols-[4.5rem_minmax(0,14rem)_minmax(0,1fr)]";

const WHAT_CLASS = "col-start-2 min-w-0 truncate @min-[40rem]/main:col-start-3";

/** An event's day, which a deadline shows as the latest it may come, explained by `hint`. */
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
  const day = date.slice("YYYY-".length);
  const deadline = timing === EventTiming.Deadline;

  return (
    <span
      className={cn("text-xs tabular-nums", deadline && "text-muted")}
      title={deadline ? hint : undefined}>
      {deadline ? t("calendar.by", { date: day }) : day}
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
 * The listings' coming filings and distributions and their markets' economic releases, soonest
 * first, with the listings and markets whose dates could not be read.
 */
export function UpcomingEvents({ symbols }: { symbols: SymbolRef[] }) {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(upcomingEventsQuery(symbols));

  if (error) return <LoadError error={error} onRetry={() => void refetch()} />;

  if (!data) return <LoadingState />;

  const rows = sortBy(
    [
      ...data.events.map((event) => ({
        date: event.date,
        row: (
          <EventRow
            key={`${symbolKey(event.symbol)}:${event.kind}:${event.date}:${event.subject}`}
            event={event}
          />
        ),
      })),
      ...data.releases.map((release) => ({
        date: release.date,
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

  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 ? (
        <p className="rounded-sm pencil px-3 py-3 text-xs text-muted">
          {t("calendar.empty", { days: CALENDAR_DAYS })}
        </p>
      ) : (
        <ul className="divide-y divide-separator">
          {rows.map(({ row }) => row)}
        </ul>
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
