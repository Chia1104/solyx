import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { storyScore } from "@solyx/core/news";
import type { Headline } from "@solyx/core/news";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { ListingName } from "../market/listing-name.tsx";

import { PublishedTime } from "./news-list.tsx";
import { HEADLINE_DAYS, newsHeadlinesQuery } from "./news-query.ts";
import { GaugeBar } from "./sentiment-gauge.tsx";

function HeadlineRow({ headline: { story, symbols } }: { headline: Headline }) {
  const { t } = useTranslation();
  const { item } = story.lead;
  const score = storyScore(story);
  const alike = story.records.length - 1;

  return (
    <li className="flex flex-col gap-1 py-2.5">
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
        <span className="line-clamp-1 text-xs text-muted">{item.snippet}</span>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted tabular-nums">
        {symbols.map((symbol) => (
          <Link
            key={symbolKey(symbol)}
            to="/symbol/$market/$symbol"
            params={symbol}
            className="flex min-w-0 items-baseline gap-1 text-foreground hover:underline">
            <span className="shrink-0 font-medium">{symbol.symbol}</span>
            <ListingName symbol={symbol} />
          </Link>
        ))}
        <span>
          <PublishedTime
            market={symbols[0].market}
            published={item.published}
          />
        </span>
        <span>{t(`news.channels.${story.channel}`)}</span>
        {alike === 0 ? null : <span>{t("news.alike", { count: alike })}</span>}
        <span>{item.site}</span>
        {score === null ? null : (
          <span className="flex items-center gap-1.5">
            {score}
            <GaugeBar score={score} className="w-8" />
          </span>
        )}
      </div>
    </li>
  );
}

/** The stories that weigh most about the listings, each with the listings it is about. */
export function HeadlineList({ symbols }: { symbols: SymbolRef[] }) {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(newsHeadlinesQuery(symbols));

  if (error) return <LoadError error={error} onRetry={() => void refetch()} />;

  if (!data) return <LoadingState />;

  if (data.length === 0) {
    return (
      <p className="rounded-sm pencil px-3 py-3 text-xs text-muted">
        {t("news.headlines.empty", { days: HEADLINE_DAYS })}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-separator">
      {data.map((headline) => (
        <HeadlineRow
          key={`${headline.story.records[0].source}:${headline.story.records[0].item.id}`}
          headline={headline}
        />
      ))}
    </ul>
  );
}
