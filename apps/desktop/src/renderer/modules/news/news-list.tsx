import { useState } from "react";
import type { ReactNode } from "react";

import { cn } from "@heroui/react";
import { NewsIcon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { uniq } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { exchangeTime } from "@solyx/core/market";
import type { Market, SymbolRef } from "@solyx/core/market";
import {
  NewsChannel,
  TimePrecision,
  isAboutListing,
  newsStories,
  storyScore,
} from "@solyx/core/news";
import type { NewsStory, Published } from "@solyx/core/news";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { ToggleMenu } from "../../components/toggle-menu.tsx";
import { useDecisionsReady } from "../settings/settings-query.ts";

import { newsRecordsQuery, useNewsChanges } from "./news-query.ts";
import { GaugeBar, SentimentGauge } from "./sentiment-gauge.tsx";

/** A publication time no more exact than its source tells it, without the year. */
export function PublishedTime({
  market,
  published,
}: {
  market: Market;
  published: Published | null;
}) {
  const { t } = useTranslation();

  if (!published) return t("news.undated");

  const time = exchangeTime(market, published.at).slice("YYYY-".length);

  const shown: Record<TimePrecision, string> = {
    [TimePrecision.Minute]: time,
    [TimePrecision.Hour]: t("news.approximate", { time }),
    [TimePrecision.Day]: time.slice(0, "MM-DD".length),
  };

  return shown[published.precision];
}

function StoryRow({
  market,
  story,
  scored,
}: {
  market: Market;
  story: NewsStory;
  /** The list shows scores: a decisions model scores the news, or a story was scored before. */
  scored: boolean;
}) {
  const { t } = useTranslation();
  const { lead } = story;
  const { item } = lead;
  const score = storyScore(story);
  const others = story.records.filter((record) => record !== lead);

  return (
    // One line where the main view is wide; narrower, the byline drops under the title.
    <li
      className={cn(
        "grid items-start gap-x-3 gap-y-0.5 px-6 py-2",
        scored
          ? "grid-cols-[minmax(0,1fr)_auto] @min-[48rem]/main:grid-cols-[6rem_2.5rem_minmax(0,1fr)_auto_5rem]"
          : "grid-cols-[minmax(0,1fr)] @min-[48rem]/main:grid-cols-[6rem_2.5rem_minmax(0,1fr)_auto]"
      )}>
      <div className="flex min-w-0 flex-col gap-0.5 @min-[48rem]/main:col-start-3 @min-[48rem]/main:row-start-1">
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="truncate text-sm hover:underline">
            {item.title}
          </a>
        ) : (
          <span className="truncate text-sm">{item.title}</span>
        )}
        {item.snippet ? (
          <span className="line-clamp-1 text-xs text-muted">
            {item.snippet}
          </span>
        ) : null}
      </div>
      {scored ? (
        <span className="flex items-center justify-end gap-1.5 pt-0.5 text-xs text-muted tabular-nums @min-[48rem]/main:col-start-5 @min-[48rem]/main:row-start-1">
          {score ?? "—"}
          <GaugeBar score={score} className="w-8" />
        </span>
      ) : null}
      <div className="col-span-full flex flex-wrap gap-x-3 text-xs text-muted tabular-nums @min-[48rem]/main:contents">
        <span className="@min-[48rem]/main:col-start-1 @min-[48rem]/main:row-start-1 @min-[48rem]/main:pt-0.5">
          <PublishedTime market={market} published={item.published} />
        </span>
        <span className="@min-[48rem]/main:col-start-2 @min-[48rem]/main:row-start-1 @min-[48rem]/main:pt-0.5">
          {t(`news.channels.${story.channel}`)}
        </span>
        <span className="flex gap-3 @min-[48rem]/main:col-start-4 @min-[48rem]/main:row-start-1 @min-[48rem]/main:pt-0.5">
          {item.votes === null ? null : (
            <span>{t("news.votes", { votes: item.votes })}</span>
          )}
          {others.length === 0 ? null : (
            <span
              title={uniq(others.map((record) => record.item.site)).join(", ")}>
              {t("news.alike", { count: others.length })}
            </span>
          )}
          <span>{item.site}</span>
        </span>
      </div>
    </li>
  );
}

/**
 * The stories collected about a listing over the symbol page's window, newest first, under a
 * header that carries their sentiment, filling the height it is given.
 */
export function NewsList({
  symbol,
  heading,
}: {
  symbol: SymbolRef;
  /** What leads the header row in place of the title, such as a switch to another view. */
  heading?: ReactNode;
}) {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(newsRecordsQuery(symbol));
  const scoring = useDecisionsReady();

  const [channels, setChannels] = useState<NewsChannel[]>(() =>
    Object.values(NewsChannel)
  );

  useNewsChanges();

  const stories = newsStories(data ?? []).filter(
    (story) => isAboutListing(story) && channels.includes(story.channel)
  );

  const scored = scoring || stories.some((story) => storyScore(story) !== null);

  let body = (
    <ul className="divide-y divide-separator">
      {stories.map((story) => (
        <StoryRow
          key={`${story.records[0].source}:${story.records[0].item.id}`}
          market={symbol.market}
          story={story}
          scored={scored}
        />
      ))}
    </ul>
  );

  if (error) {
    body = (
      <div className="px-6 py-4">
        <LoadError error={error} onRetry={() => void refetch()} />
      </div>
    );
  } else if (!data) {
    body = <LoadingState />;
  } else if (stories.length === 0) {
    body = <p className="px-6 py-4 text-sm text-muted">{t("news.empty")}</p>;
  }

  return (
    <section
      aria-label={t("news.title")}
      className="flex h-full flex-col overflow-hidden">
      {/* 40px over its rule, so the news collapses to this row and its readout. */}
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-separator px-6">
        {heading ?? (
          <h2 className="shrink-0 text-sm font-medium">{t("news.title")}</h2>
        )}
        <ToggleMenu
          label={t("news.channels-label")}
          icon={NewsIcon}
          options={Object.values(NewsChannel).map((channel) => ({
            id: channel,
            label: t(`news.channels.${channel}`),
          }))}
          selected={channels}
          onChange={setChannels}
          disallowEmptySelection
        />
        <div className="ml-auto flex">
          <SentimentGauge symbol={symbol} scoring={scoring} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </section>
  );
}
