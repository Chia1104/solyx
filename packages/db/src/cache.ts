import {
  and,
  asc,
  count,
  countDistinct,
  eq,
  gte,
  lt,
  lte,
  sql,
} from "drizzle-orm";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { chunk } from "es-toolkit";

import type { Candle, Interval } from "@solyx/core/candles";
import type { Market } from "@solyx/core/market";
import type { AnswerStore, AnswerStores } from "@solyx/utils/fresh";

import { candleSeries, candles, keptAnswers } from "./cache-schema.ts";
import { connect } from "./connection.ts";
import { databaseBytes, removeDatabase } from "./database-file.ts";

// SQLite caps bound parameters per statement; eight columns per bar stays well under it.
const INSERT_BATCH = 1000;

// Every reader's answers go stale within a day, so one this old is never read again.
const ANSWER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface CandleSeriesKey {
  /** The provider's `id`, so providers never mix bars. */
  source: string;
  market: Market;
  symbol: string;
  interval: Interval;
}

/** Exchange-local dates (`YYYY-MM-DD`) between which every closed session is stored. */
export interface CandleCoverage {
  from: string;
  to: string;
}

export interface DatedCandle {
  candle: Candle;
  /** The bar's exchange-local session date. */
  date: string;
}

function candleStore(db: NodeSQLiteDatabase) {
  const seriesOf = (key: CandleSeriesKey) =>
    and(
      eq(candleSeries.source, key.source),
      eq(candleSeries.market, key.market),
      eq(candleSeries.symbol, key.symbol),
      eq(candleSeries.interval, key.interval)
    );

  return {
    coverage: (key: CandleSeriesKey): CandleCoverage | undefined =>
      db
        .select({ from: candleSeries.coveredFrom, to: candleSeries.coveredTo })
        .from(candleSeries)
        .where(seriesOf(key))
        .get(),

    /** Upserts bars and widens coverage; coverage only grows here. */
    store(key: CandleSeriesKey, bars: DatedCandle[], coverage: CandleCoverage) {
      db.transaction((tx) => {
        const series = tx
          .insert(candleSeries)
          .values({
            ...key,
            coveredFrom: coverage.from,
            coveredTo: coverage.to,
          })
          .onConflictDoUpdate({
            target: [
              candleSeries.source,
              candleSeries.market,
              candleSeries.symbol,
              candleSeries.interval,
            ],
            set: {
              coveredFrom: sql`min(${candleSeries.coveredFrom}, excluded.covered_from)`,
              coveredTo: sql`max(${candleSeries.coveredTo}, excluded.covered_to)`,
            },
          })
          .returning({ id: candleSeries.id })
          .get();

        for (const batch of chunk(bars, INSERT_BATCH)) {
          tx.insert(candles)
            .values(
              batch.map(({ candle, date }) => ({
                seriesId: series.id,
                date,
                ...candle,
              }))
            )
            .onConflictDoUpdate({
              target: [candles.seriesId, candles.time],
              set: {
                date: sql`excluded.date`,
                open: sql`excluded.open`,
                high: sql`excluded.high`,
                low: sql`excluded.low`,
                close: sql`excluded.close`,
                volume: sql`excluded.volume`,
              },
            })
            .run();
        }
      });
    },

    /** Bars whose session date falls between `from` and `to`, oldest first. */
    read: (key: CandleSeriesKey, from: string, to: string): Candle[] =>
      db
        .select({
          time: candles.time,
          open: candles.open,
          high: candles.high,
          low: candles.low,
          close: candles.close,
          volume: candles.volume,
        })
        .from(candles)
        .innerJoin(candleSeries, eq(candles.seriesId, candleSeries.id))
        .where(
          and(seriesOf(key), gte(candles.date, from), lte(candles.date, to))
        )
        .orderBy(asc(candles.time))
        .all(),

    /** Drops bars before `from` and narrows coverage to match. */
    trim(key: CandleSeriesKey, from: string) {
      db.transaction((tx) => {
        const series = tx
          .select({ id: candleSeries.id })
          .from(candleSeries)
          .where(seriesOf(key))
          .get();

        if (!series) return;

        tx.delete(candles)
          .where(and(eq(candles.seriesId, series.id), lt(candles.date, from)))
          .run();
        tx.update(candleSeries)
          .set({ coveredFrom: sql`max(${candleSeries.coveredFrom}, ${from})` })
          .where(eq(candleSeries.id, series.id))
          .run();
      });
    },

    /** Deletes the series and, through the foreign key, its bars. */
    remove(key: CandleSeriesKey) {
      db.delete(candleSeries).where(seriesOf(key)).run();
    },
  };
}

export type CandleStore = ReturnType<typeof candleStore>;

/** Each scope's answers, kept as its reader's `keepFresh` wrote them. */
function answerStores(db: NodeSQLiteDatabase): AnswerStores {
  const under = (scope: string, key: string) =>
    and(eq(keptAnswers.scope, scope), eq(keptAnswers.key, key));

  return <Answer>(scope: string): AnswerStore<Answer> => ({
    read(key) {
      const row = db
        .select({ askedAt: keptAnswers.askedAt, answer: keptAnswers.answer })
        .from(keptAnswers)
        .where(under(scope, key))
        .get();

      // SAFETY: a scope's rows are written by `write` below with the `Answer` its one reader keeps.
      return row && { askedAt: row.askedAt, answer: row.answer as Answer };
    },

    write(key, { askedAt, answer }) {
      db.insert(keptAnswers)
        .values({ scope, key, askedAt, answer })
        .onConflictDoUpdate({
          target: [keptAnswers.scope, keptAnswers.key],
          set: {
            askedAt: sql`excluded.asked_at`,
            answer: sql`excluded.answer`,
          },
        })
        .run();
    },

    forget() {
      db.delete(keptAnswers).where(eq(keptAnswers.scope, scope)).run();
    },
  });
}

/** What one provider's bars take up in the cache. */
export interface SourceUsage {
  /** The provider's `id`. */
  source: string;
  series: number;
  bars: number;
}

export interface CacheUsage {
  /** The file on disk, with its write-ahead log. */
  bytes: number;
  sources: SourceUsage[];
}

/**
 * The cache database, holding only what can be fetched again. A file that is corrupt, or
 * holds a schema these migrations do not know, is deleted and rebuilt; a second failure is
 * a real error. `migrationsFolder` is `migrations/cache` wherever the host ships it.
 */
export function openCache(path: string, migrationsFolder: string) {
  let connection: ReturnType<typeof connect>;

  try {
    connection = connect(path, migrationsFolder);
  } catch {
    removeDatabase(path);
    connection = connect(path, migrationsFolder);
  }

  const { client, db } = connection;

  db.delete(keptAnswers)
    .where(lt(keptAnswers.askedAt, Date.now() - ANSWER_RETENTION_MS))
    .run();

  return {
    candles: candleStore(db),

    answers: answerStores(db),

    usage(): CacheUsage {
      const sources = db
        .select({
          source: candleSeries.source,
          series: countDistinct(candleSeries.id),
          bars: count(candles.time),
        })
        .from(candleSeries)
        .leftJoin(candles, eq(candles.seriesId, candleSeries.id))
        .groupBy(candleSeries.source)
        .orderBy(asc(candleSeries.source))
        .all();

      return { bytes: databaseBytes(path), sources };
    },

    /** Deletes every series and its bars and every answer kept, and gives the space back to the disk. */
    clear() {
      db.delete(candleSeries).run();
      db.delete(keptAnswers).run();
      // VACUUM rewrites the file through the log, so the log is truncated after it.
      client.exec("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);");
    },

    close: () => client.close(),
  };
}

export type Cache = ReturnType<typeof openCache>;
