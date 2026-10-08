import { Tooltip, cn } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { clamp } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { exchangeTime } from "@solyx/core/market";
import type { Market, SymbolRef } from "@solyx/core/market";
import { NewsVoice } from "@solyx/core/news";
import type { NewsReading, SentimentReading } from "@solyx/core/news";

import type { NewsCoverage } from "#shared/ipc/news.ts";

import { SettingsSection } from "../settings/settings-section.ts";

import { NEWS_DAYS, newsCoverageQuery } from "./news-query.ts";

const TOOLTIP_DELAY = 600;

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

const shown = (reading: SentimentReading) => reading.score ?? "—";

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
 * The listing's news sentiment over the symbol page's window, overall and for the press and the
 * crowd, or a link to set up the decisions model that scores it while nothing was scored before.
 * Where the main view is narrow only the overall reading and failing sources show.
 */
export function SentimentGauge({
  symbol,
  gauge,
  scoring,
}: {
  symbol: SymbolRef;
  /** `undefined` until the listing's news is read. */
  gauge: NewsReading["gauge"] | undefined;
  /** Whether a decisions model scores the news. */
  scoring: boolean;
}) {
  const { t } = useTranslation();
  const { data: coverage } = useQuery(newsCoverageQuery(symbol));

  if (!gauge) return null;

  const { overall, voices } = gauge;

  return (
    <div className="flex shrink-0 items-center gap-3 text-xs text-muted tabular-nums">
      {scoring || overall.score !== null ? (
        <span
          className="flex items-center gap-2"
          title={t("news.gauge.hint", { days: NEWS_DAYS })}>
          <span>{t("news.gauge.overall", { score: shown(overall) })}</span>
          <GaugeBar score={overall.score} />
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
