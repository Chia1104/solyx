import { groupBy, mapAsync } from "es-toolkit";

import type { Market, SymbolRef } from "@solyx/core/market";
import type { MarketData } from "@solyx/core/market-data";
import { rankHeadlines, readNews } from "@solyx/core/news";
import type {
  Headline,
  NewsCollection,
  NewsSource,
  NewsStore,
  SourceHealth,
} from "@solyx/core/news";
import type { SentimentScorer } from "@solyx/core/sentiment";
import { errorMessage } from "@solyx/utils/error";

import type { NewsCoverage } from "#shared/ipc/news.ts";

const HOUR_MS = 60 * 60 * 1000;

const DAY_MS = 24 * HOUR_MS;

// A listing's first refresh reaches back a week; later ones overlap the last collection by a day.
const FIRST_LOOKBACK_MS = 7 * DAY_MS;

const OVERLAP_MS = DAY_MS;

// Per source, and per channel, in a refresh.
const REFRESH_ITEMS = 10;

// Requests to the decisions model at once.
const SCORING_CONCURRENCY = 4;

// A source that failed this many searches in a row rests before a refresh searches it again;
// collecting on request still tries it, and a search that works ends the rest.
const RESTING_STREAK = 3;

const REST_MS = 6 * HOUR_MS;

export interface NewsOptions {
  /** Read afresh for every collection, since a source may join once its key is saved. */
  sources: () => Promise<NewsSource[]>;
  store: NewsStore;
  /** `undefined` until the user sets up a decisions model. */
  scorer: () => Promise<SentimentScorer | undefined>;
  marketData: Pick<MarketData, "listing">;
  /** Called once per collection of a listing's news, even one that failed partway. */
  onChange: (symbol: SymbolRef) => void;
  /** @default () => new Date() */
  now?: () => Date;
}

function isResting(health: SourceHealth | undefined, at: Date) {
  return (
    health?.lastFailureAt != null &&
    health.failureStreak >= RESTING_STREAK &&
    at.getTime() - health.lastFailureAt.getTime() < REST_MS
  );
}

/**
 * Listing news as the app keeps it: collected on request for the agent and refreshed for watched
 * listings, both through one collection that stores what each source finds and how its search
 * went, then scores each channel's newest stories that hold no score yet.
 */
export function createNews(options: NewsOptions) {
  const { store } = options;
  const now = options.now ?? (() => new Date());

  const healthBySource = () =>
    new Map(store.sourceHealth().map((health) => [health.source, health]));

  async function sourcesFor(market: Market) {
    return (await options.sources()).filter((source) =>
      source.markets.includes(market)
    );
  }

  async function collect(
    symbol: SymbolRef,
    sources: readonly NewsSource[],
    since: Date,
    limit: number
  ): Promise<NewsCollection> {
    const at = now();

    try {
      // The name only sharpens the searches, so collection goes on without it.
      const listing = await options.marketData
        .listing(symbol)
        .catch(() => null);

      const query = { symbol, listing, since, limit };

      // One source failing leaves the others' items, and what it found before, in the collection.
      const results = await Promise.allSettled(
        sources.map((source) => source.search(query))
      );

      for (const [index, result] of results.entries()) {
        const source = sources[index];

        if (result.status === "fulfilled") {
          store.save(symbol, source, result.value, at);
          store.markSearched(source.id, at, null);
        } else {
          store.markSearched(source.id, at, errorMessage(result.reason));
        }
      }

      // Marked even when a source failed, so a broken source is not searched again and again.
      store.markCollected(symbol, at);

      const health = healthBySource();

      const failures = sources.flatMap((source, index) => {
        const failed =
          results[index].status === "rejected" && health.get(source.id);

        return failed ? [failed] : [];
      });

      const subject = { symbol, listing };
      const read = readNews(store.list(symbol, since), subject);

      const newest = Object.values(
        groupBy(read.stories, (story) => story.channel)
      ).flatMap((stories) => stories.slice(0, limit));

      const scorer = await options.scorer();

      if (!scorer) {
        return {
          stories: newest,
          gauge: read.gauge,
          daily: read.daily,
          failures,
          scored: false,
        };
      }

      // A story is judged once, however often and wherever it is found.
      const stories = await mapAsync(
        newest,
        async (story) => {
          const { lead } = story;

          if (lead.score) return story;

          const score = await scorer.score({
            symbol,
            listing,
            title: lead.item.title,
            text: lead.item.snippet,
            site: lead.item.site,
            url: lead.item.url,
          });

          store.saveScore(symbol, lead, score);

          const scored = { ...lead, score };

          return {
            ...story,
            lead: scored,
            records: story.records.map((record) =>
              record === lead ? scored : record
            ),
          };
        },
        { concurrency: SCORING_CONCURRENCY }
      );

      // Read again, so the gauge counts the scores just given.
      const { gauge, daily } = readNews(store.list(symbol, since), subject);

      return {
        stories,
        gauge,
        daily,
        failures,
        scored: true,
      };
    } finally {
      options.onChange(symbol);
    }
  }

  return {
    /** Every source covering the listing's market, resting or not, as the agent asks. */
    async collect(
      symbol: SymbolRef,
      since: Date,
      limit: number
    ): Promise<NewsCollection> {
      const sources = await sourcesFor(symbol.market);

      if (sources.length === 0) {
        throw new Error(
          `No news source covers ${symbol.market}: the ones that do need a key the user has not saved in the app's settings`
        );
      }

      return collect(symbol, sources, since, limit);
    },

    /**
     * Collects the listing once its last collection is `everyMs` old, leaving out sources that
     * keep failing. A listing only resting sources cover stays due, so it is collected once one
     * recovers.
     */
    async refresh(symbol: SymbolRef, everyMs: number): Promise<void> {
      const at = now();
      const last = store.lastCollected(symbol);

      if (last !== null && at.getTime() - last.getTime() < everyMs) return;

      const health = healthBySource();

      const searchable = (await sourcesFor(symbol.market)).filter(
        (source) => !isResting(health.get(source.id), at)
      );

      if (searchable.length === 0) return;

      const since = last
        ? new Date(last.getTime() - OVERLAP_MS)
        : new Date(at.getTime() - FIRST_LOOKBACK_MS);

      await collect(symbol, searchable, since, REFRESH_ITEMS);
    },

    /** What is stored about the listing since `since`, newest first. */
    records: (symbol: SymbolRef, since: Date) => store.list(symbol, since),

    /** The `limit` heaviest headlines about the listings since `since`, each grouped by its names once known. */
    async headlines(
      symbols: readonly SymbolRef[],
      since: Date,
      limit: number
    ): Promise<Headline[]> {
      const listings = await Promise.all(
        symbols.map(async (symbol) => ({
          subject: {
            symbol,
            listing: await options.marketData.listing(symbol).catch(() => null),
          },
          records: store.list(symbol, since),
        }))
      );

      return rankHeadlines(listings, now()).slice(0, limit);
    },

    /** Where the listing's news comes from, so a quiet listing can be told from a broken source. */
    async coverage(symbol: SymbolRef): Promise<NewsCoverage> {
      const health = healthBySource();

      return {
        collectedAt: store.lastCollected(symbol),
        sources: (await sourcesFor(symbol.market)).map(({ id, channel }) => ({
          id,
          channel,
          health: health.get(id) ?? null,
        })),
      };
    },
  };
}

export type News = ReturnType<typeof createNews>;
