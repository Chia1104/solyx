import type { Market, SymbolRef } from "@solyx/core/market";
import type { MarketDataProvider } from "@solyx/core/market-data";
import { collectNews } from "@solyx/core/news";
import type { NewsSource, NewsStore, SourceHealth } from "@solyx/core/news";
import type { SentimentScorer } from "@solyx/core/sentiment";
import { errorMessage } from "@solyx/utils/error";

const HOUR_MS = 60 * 60 * 1000;

const DAY_MS = 24 * HOUR_MS;

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

// Lets the app finish starting before the first check.
const FIRST_CHECK_MS = 60 * 1000;

// A listing's first collection reaches back a week; later ones overlap the last by a day.
const FIRST_LOOKBACK_MS = 7 * DAY_MS;

const OVERLAP_MS = DAY_MS;

const ITEMS = 10;

// A source that failed this many searches in a row rests before the collector searches it again;
// the agent's searches still try it, and one that works ends the rest.
const RESTING_STREAK = 3;

const REST_MS = 6 * HOUR_MS;

const SCORING_CONCURRENCY = 4;

export interface NewsCollectorOptions {
  sources: () => Promise<NewsSource[]>;
  store: NewsStore;
  scorer: () => Promise<SentimentScorer | undefined>;
  marketData: (market: Market) => Promise<MarketDataProvider | undefined>;
  watchlist: () => SymbolRef[];
  /** Read before every check, so a changed setting applies without a restart; 0 stops collecting. */
  collectEveryHours: () => number;
  now?: () => Date;
}

/**
 * Collects news for every watched listing at the interval the user set while the app runs, so
 * the history behind the sentiment gauge grows without the agent asking. A collection the agent
 * made counts.
 */
export function createNewsCollector(options: NewsCollectorOptions) {
  const now = options.now ?? (() => new Date());
  let checking = false;
  let timers: NodeJS.Timeout[] = [];

  function isDue(symbol: SymbolRef, at: Date, intervalMs: number) {
    const last = options.store.lastCollected(symbol);

    return last === null || at.getTime() - last.getTime() >= intervalMs;
  }

  function isResting(health: SourceHealth | undefined, at: Date) {
    return (
      health?.lastFailureAt != null &&
      health.failureStreak >= RESTING_STREAK &&
      at.getTime() - health.lastFailureAt.getTime() < REST_MS
    );
  }

  async function collect(
    symbol: SymbolRef,
    sources: NewsSource[],
    scorer: SentimentScorer | undefined
  ) {
    const at = now();
    const last = options.store.lastCollected(symbol);
    const provider = await options.marketData(symbol.market);

    // The name only sharpens the searches, so collection goes on without it.
    const listing = provider
      ? await provider.getListing(symbol).catch(() => null)
      : null;

    const since = last
      ? new Date(last.getTime() - OVERLAP_MS)
      : new Date(at.getTime() - FIRST_LOOKBACK_MS);

    await collectNews({
      sources,
      store: options.store,
      scorer,
      query: { symbol, listing, since, limit: ITEMS },
      now: at,
      concurrency: SCORING_CONCURRENCY,
    });
  }

  /** Collects each due listing in turn, one at a time, so no source sees a burst. */
  async function check() {
    const intervalMs = options.collectEveryHours() * HOUR_MS;

    if (checking || intervalMs === 0) return;

    checking = true;

    try {
      const sources = await options.sources();
      const scorer = await options.scorer();

      for (const symbol of options.watchlist()) {
        const at = now();

        // Read for each listing, since the one before may have just failed a source.
        const health = new Map(
          options.store.sourceHealth().map((source) => [source.source, source])
        );

        // A listing only resting sources cover stays due, so it is collected once one recovers.
        const searchable = sources.filter(
          (source) =>
            source.markets.includes(symbol.market) &&
            !isResting(health.get(source.id), at)
        );

        if (searchable.length === 0 || !isDue(symbol, at, intervalMs)) {
          continue;
        }

        try {
          await collect(symbol, searchable, scorer);
        } catch (error) {
          console.error(
            `News collection for ${symbol.market} ${symbol.symbol} failed: ${errorMessage(error)}`
          );
        }
      }
    } finally {
      checking = false;
    }
  }

  return {
    check,

    start() {
      const run = () => void check().catch(console.error);

      timers = [
        setTimeout(run, FIRST_CHECK_MS),
        setInterval(run, CHECK_INTERVAL_MS),
      ];
    },

    stop() {
      for (const timer of timers) clearTimeout(timer);

      timers = [];
    },
  };
}
