import { groupBy, mapAsync, omit, uniqBy } from "es-toolkit";

import type { Embedder } from "@solyx/core/embedding";
import type { Market, SymbolRef } from "@solyx/core/market";
import type { MarketData } from "@solyx/core/market-data";
import { rankHeadlines, readNews, storyText } from "@solyx/core/news";
import type {
  Headline,
  NewsCollection,
  NewsMatch,
  NewsReading,
  NewsRecord,
  NewsSource,
  NewsStore,
  NewsStory,
  SourceHealth,
} from "@solyx/core/news";
import type { SentimentScorer } from "@solyx/core/sentiment";
import { errorMessage } from "@solyx/utils/error";
import { fuseRankings } from "@solyx/utils/search";

import type { NewsCoverage } from "#shared/ipc/news.ts";

import type { Diagnostics } from "../telemetry/diagnostics.ts";

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
  diagnostics: Pick<Diagnostics, "recovered">;
  /** Read afresh for every collection, since a source may join once its key is saved. */
  sources: () => Promise<NewsSource[]>;
  store: NewsStore;
  /** `undefined` until the user sets up a decisions model. */
  scorer: () => Promise<SentimentScorer | undefined>;
  /** `undefined` while news groups by titles alone. */
  embedder: () => Promise<Embedder | undefined>;
  /** Embeds what the agent searches for; only a model on this computer, since a query is the user's own. */
  localEmbedder: () => Embedder | undefined;
  marketData: Pick<MarketData, "listing">;
  /** Called once per collection of a listing's news, even one that failed partway. */
  onChange: (symbol: SymbolRef) => void;
  /** @default () => new Date() */
  now?: () => Date;
}

/** A story as windows get it: vectors stay in the main process. */
const shown = (story: NewsStory): NewsStory => ({
  ...story,
  lead: omit(story.lead, ["embedding"]),
  records: story.records.map((record) => omit(record, ["embedding"])),
});

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

  /**
   * The listing's records since `since`, each with its vector once the embedder gave one. Items
   * without one are embedded now; while the embedder cannot be reached, they group by titles alone.
   */
  async function embedded(
    symbol: SymbolRef,
    since: Date,
    embedder: Embedder | undefined
  ): Promise<NewsRecord[]> {
    const records = store.list(symbol, since, embedder?.space);

    if (!embedder) return records;

    const missing = uniqBy(
      records.filter((record) => !record.embedding),
      ({ source, item }) => `${source}:${item.id}`
    );

    if (missing.length === 0) return records;

    try {
      const vectors = await embedder.embed(
        missing.map(({ item }) => storyText(item))
      );

      store.saveEmbeddings(
        embedder.space,
        missing.map((record, index) => ({ record, values: vectors[index] }))
      );
    } catch (error) {
      options.diagnostics.recovered(error, "news.embed");

      return records;
    }

    return store.list(symbol, since, embedder.space);
  }

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
      const embedder = await options.embedder();
      const read = readNews(await embedded(symbol, since, embedder), subject);

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
      const { gauge, daily } = readNews(
        store.list(symbol, since, embedder?.space),
        subject
      );

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

    /** When the listing's news was last collected, by a refresh or for the agent; `null` before the first. */
    lastCollected: (symbol: SymbolRef): Date | null =>
      store.lastCollected(symbol),

    /**
     * Collects the listing where `due` says so of its last collection, leaving out sources that
     * keep failing. A listing only resting sources cover stays due, so it is collected once one
     * recovers.
     */
    async refresh(
      symbol: SymbolRef,
      due: (last: Date | null) => boolean
    ): Promise<void> {
      const at = now();
      const last = store.lastCollected(symbol);

      if (!due(last)) return;

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

    /** The listing's stories since `since`, grouped as `get_news` groups them. */
    async reading(symbol: SymbolRef, since: Date): Promise<NewsReading> {
      const [listing, embedder] = await Promise.all([
        options.marketData.listing(symbol).catch(() => null),
        options.embedder(),
      ]);

      const reading = readNews(await embedded(symbol, since, embedder), {
        symbol,
        listing,
      });

      return { ...reading, stories: reading.stories.map(shown) };
    },

    /**
     * What is stored, by words and, where a model on this computer embeds the query in the space
     * the items were embedded in, by meaning as well.
     */
    async search(
      query: string,
      limit: number,
      symbol?: SymbolRef
    ): Promise<NewsMatch[]> {
      const byWords = store.search(query, limit, symbol);
      const local = options.localEmbedder();

      if (!local) return byWords;

      try {
        const [asked] = await local.embed([query]);

        return fuseRankings(
          [byWords, store.nearest(local.space, asked, limit, symbol)],
          ({ source, item }) => `${source}:${item.id}`
        ).slice(0, limit);
      } catch (error) {
        options.diagnostics.recovered(error, "news.search.embed");

        return byWords;
      }
    },

    /** The `limit` heaviest headlines about the listings since `since`, each grouped by its names once known. */
    async headlines(
      symbols: readonly SymbolRef[],
      since: Date,
      limit: number
    ): Promise<Headline[]> {
      const embedder = await options.embedder();

      const listings = await Promise.all(
        symbols.map(async (symbol) => ({
          subject: {
            symbol,
            listing: await options.marketData.listing(symbol).catch(() => null),
          },
          records: await embedded(symbol, since, embedder),
        }))
      );

      return rankHeadlines(listings, now())
        .slice(0, limit)
        .map((headline) => ({ ...headline, story: shown(headline.story) }));
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
