import { useState } from "react";

import { ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { uniq } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { exchangeTime } from "@solyx/core/market";
import type { Market, SymbolRef } from "@solyx/core/market";
import {
  NewsChannel,
  isAboutListing,
  newsStories,
  storyScore,
} from "@solyx/core/news";
import type { NewsStory } from "@solyx/core/news";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";

import { newsRecordsQuery, useNewsChanges } from "./news-query.ts";
import { GaugeBar } from "./sentiment-gauge.tsx";

function StoryRow({ market, story }: { market: Market; story: NewsStory }) {
  const { t } = useTranslation();
  const { lead } = story;
  const { item } = lead;
  const score = storyScore(story);
  const others = story.records.filter((record) => record !== lead);

  return (
    <li className="flex items-start gap-3 px-6 py-2">
      <span className="w-20 shrink-0 pt-0.5 text-xs text-muted tabular-nums">
        {item.publishedAt
          ? exchangeTime(market, item.publishedAt).slice(5)
          : t("news.undated")}
      </span>
      <span className="w-8 shrink-0 pt-0.5 text-xs text-muted">
        {t(`news.channels.${story.channel}`)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
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
      <span className="flex shrink-0 items-center gap-3 pt-0.5 text-xs text-muted tabular-nums">
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
        <span className="flex w-20 items-center justify-end gap-1.5">
          {score ?? "—"}
          <GaugeBar score={score} className="w-8" />
        </span>
      </span>
    </li>
  );
}

/** The stories collected about a listing over the symbol page's window, newest first. */
export function NewsList({ symbol }: { symbol: SymbolRef }) {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(newsRecordsQuery(symbol));

  const [channels, setChannels] = useState<NewsChannel[]>(() =>
    Object.values(NewsChannel)
  );

  useNewsChanges();

  const stories = newsStories(data ?? []).filter(
    (story) => isAboutListing(story) && channels.includes(story.channel)
  );

  let body = (
    <ul className="divide-y divide-separator">
      {stories.map((story) => (
        <StoryRow
          key={`${story.records[0].source}:${story.records[0].item.id}`}
          market={symbol.market}
          story={story}
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
      className="flex h-64 shrink-0 flex-col border-t border-separator">
      <div className="flex min-h-10 shrink-0 items-center gap-3 border-b border-separator px-6 py-1.5">
        <h2 className="text-sm font-medium">{t("news.title")}</h2>
        <ToggleButtonGroup
          aria-label={t("news.channels-label")}
          selectionMode="multiple"
          size="sm"
          isDetached
          selectedKeys={channels}
          onSelectionChange={(keys) =>
            setChannels(
              Object.values(NewsChannel).filter((channel) => keys.has(channel))
            )
          }>
          {Object.values(NewsChannel).map((channel) => (
            <ToggleButton key={channel} id={channel}>
              {t(`news.channels.${channel}`)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </section>
  );
}
