import { Tooltip, cn } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { clamp } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { exchangeDate, exchangeTime } from "@solyx/core/market";
import type { Market, SymbolRef } from "@solyx/core/market";
import { NewsVoice } from "@solyx/core/news";
import type {
  NewsReading,
  SentimentDay,
  SentimentReading,
} from "@solyx/core/news";
import { cssPercent } from "@solyx/utils/format";

import type { NewsCoverage } from "#shared/news.ts";
import { SettingsSection } from "#shared/settings-section.ts";

import { NEWS_DAYS, newsCoverageQuery } from "./news-query.ts";

const TOOLTIP_DELAY = 600;

/** The gauge's coldest and hottest ends, whose colours a day leaning that way takes. */
const COLD = "#60a5fa";

const HOT = "#f97316";

/** A score's place from cold to hot: a bar with a mark at the score, faded when there is none. */
export function GaugeBar({
  score,
  className,
}: {
  score: number | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        // Cold to hot without red or green, which belong to price direction.
        "relative inline-block h-[7px] w-16 shrink-0 bg-[linear-gradient(90deg,#60a5fa,#22d3ee_45%,#fbbf24_75%,#f97316)]",
        score === null && "opacity-30",
        className
      )}>
      {score === null ? null : (
        <i
          className="absolute -top-[3px] h-[13px] w-0.5 -translate-x-px bg-foreground"
          style={{ left: `${clamp(score, 0, 100)}%` }}
        />
      )}
    </span>
  );
}

/**
 * Each day of the window, oldest first: a column up for a warm day and down for a cold one, as
 * long as its stance is strong and as solid as how much was said that day; a day with nothing
 * scored stays a hairline.
 */
function DailyStance({
  market,
  days,
}: {
  market: Market;
  days: readonly SentimentDay[];
}) {
  const { t } = useTranslation();
  const byDate = new Map(days.map((day) => [day.date, day]));
  const today = Temporal.PlainDate.from(exchangeDate(market));
  const heaviest = Math.max(0, ...days.map(({ weight }) => weight));

  const window = Array.from({ length: NEWS_DAYS }, (_, index) =>
    today.subtract({ days: NEWS_DAYS - 1 - index }).toString()
  );

  return (
    <ol
      aria-label={t("news.gauge.daily")}
      className="flex h-5 shrink-0 gap-0.5">
      {window.map((date) => {
        const day = byDate.get(date);
        const shownDate = date.slice(5);

        if (!day || day.stance === null) {
          return (
            <li
              key={date}
              title={
                day
                  ? t("news.gauge.day-unscored", {
                      date: shownDate,
                      count: day.stories,
                    })
                  : t("news.gauge.day-none", { date: shownDate })
              }
              className="relative w-1.5">
              <span className="absolute inset-x-0 top-1/2 h-px bg-muted/50" />
            </li>
          );
        }

        return (
          <li
            key={date}
            title={t("news.gauge.day", {
              date: shownDate,
              score: Math.round((day.stance + 1) * 50),
              count: day.stories,
            })}
            className="relative w-1.5">
            <span
              className={cn(
                "absolute inset-x-0 min-h-px",
                day.stance >= 0
                  ? "bottom-1/2 rounded-t-[1px]"
                  : "top-1/2 rounded-b-[1px]"
              )}
              style={{
                height: cssPercent(Math.abs(day.stance) / 2),
                backgroundColor: day.stance >= 0 ? HOT : COLD,
                opacity:
                  heaviest === 0 ? 1 : 0.4 + (0.6 * day.weight) / heaviest,
              }}
            />
          </li>
        );
      })}
    </ol>
  );
}

/** A reading's score, or a dash while nothing is scored or too little of it is recent. */
const shown = (reading: SentimentReading) =>
  reading.recent ? (reading.score ?? "—") : "—";

/** When the listing's news was collected, and which of its sources fail, with why on hover. */
function Coverage({
  market,
  coverage,
}: {
  market: Market;
  coverage: NewsCoverage;
}) {
  const { t } = useTranslation();
  const time = (at: Date) => exchangeTime(market, at).slice(5);

  const failing = coverage.sources.flatMap(({ channel, health }) =>
    health && health.failureStreak > 0 ? [{ channel, health }] : []
  );

  return (
    <>
      <span className="hidden @min-[40rem]/main:inline">
        {coverage.collectedAt
          ? t("news.coverage.collected", { time: time(coverage.collectedAt) })
          : t("news.coverage.never")}
      </span>
      {failing.length === 0 ? null : (
        <Tooltip delay={TOOLTIP_DELAY}>
          <Tooltip.Trigger className="cursor-help text-warning underline decoration-dashed underline-offset-2">
            {t("news.coverage.failing", { count: failing.length })}
          </Tooltip.Trigger>
          <Tooltip.Content className="flex max-w-sm flex-col gap-2 py-1.5">
            {failing.map(({ channel, health }) => (
              <div key={health.source} className="flex flex-col gap-0.5">
                <p className="font-medium">
                  {t("news.coverage.failure", {
                    source: t(`news.channels.${channel}`),
                    count: health.failureStreak,
                  })}
                </p>
                <p className="text-muted">
                  {health.lastSuccessAt
                    ? t("news.coverage.last-worked", {
                        time: time(health.lastSuccessAt),
                      })
                    : t("news.coverage.never-worked")}
                </p>
                {health.lastError ? (
                  <p className="line-clamp-3 break-all text-muted">
                    {health.lastError}
                  </p>
                ) : null}
              </div>
            ))}
            <p className="text-muted">{t("news.coverage.missing")}</p>
          </Tooltip.Content>
        </Tooltip>
      )}
    </>
  );
}

/**
 * The listing's news sentiment over the symbol page's window, overall, day by day and for the
 * press and the crowd, or a link to set up the decisions model that scores it while nothing was
 * scored before. Where the main view is narrow only the overall reading and failing sources show.
 */
export function SentimentGauge({
  symbol,
  gauge,
  daily,
  scoring,
}: {
  symbol: SymbolRef;
  /** `undefined` until the listing's news is read. */
  gauge: NewsReading["gauge"] | undefined;
  daily: NewsReading["daily"] | undefined;
  /** Whether a decisions model scores the news. */
  scoring: boolean;
}) {
  const { t } = useTranslation();
  const { data: coverage } = useQuery(newsCoverageQuery(symbol));

  if (!gauge) return null;

  const { overall, voices } = gauge;
  const stale = overall.score !== null && !overall.recent;

  return (
    <div className="flex shrink-0 items-center gap-3 text-xs text-muted tabular-nums">
      {scoring || overall.score !== null ? (
        <span
          className="flex items-center gap-2"
          title={t("news.gauge.hint", { days: NEWS_DAYS })}>
          <span>{t("news.gauge.overall", { score: shown(overall) })}</span>
          <GaugeBar score={overall.recent ? overall.score : null} />
          {daily ? (
            <span className="hidden @min-[44rem]/main:flex">
              <DailyStance market={symbol.market} days={daily} />
            </span>
          ) : null}
          {stale && overall.latest ? (
            <span
              title={t("news.gauge.latest", {
                time: exchangeTime(symbol.market, overall.latest).slice(5),
              })}>
              {t("news.gauge.stale")}
            </span>
          ) : null}
          <span className="hidden @min-[52rem]/main:inline">
            {t("news.gauge.voices", {
              press: shown(voices[NewsVoice.Press]),
              crowd: shown(voices[NewsVoice.Crowd]),
            })}
          </span>
          <span className="hidden @min-[44rem]/main:inline">
            {t("news.gauge.stories", { count: overall.stories })}
          </span>
        </span>
      ) : (
        <Link
          to="/settings"
          search={{ section: SettingsSection.Agent }}
          title={t("news.gauge.unscored")}
          className="underline underline-offset-2 hover:text-foreground">
          <span className="@min-[52rem]/main:hidden">
            {t("news.gauge.off")}
          </span>
          <span className="hidden @min-[52rem]/main:inline">
            {t("news.gauge.unscored")}
          </span>
        </Link>
      )}
      {coverage ? (
        <Coverage market={symbol.market} coverage={coverage} />
      ) : null}
    </div>
  );
}
