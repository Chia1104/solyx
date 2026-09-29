import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { and, asc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { chunk } from "es-toolkit";

import type { Candle, Interval } from "@solyx/core/candles";
import type { Market } from "@solyx/core/market";

import { candleSeries, candles } from "./cache-schema.ts";

const CONNECTION_PRAGMAS = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
`;

// SQLite caps bound parameters per statement; eight columns per bar stays well under it.
const INSERT_BATCH = 1000;

function connect(path: string, migrationsFolder: string) {
  const client = new DatabaseSync(path);

  try {
    client.exec(CONNECTION_PRAGMAS);

    const db = drizzle({ client });

    migrate(db, { migrationsFolder });

    return { client, db };
  } catch (error) {
    client.close();
    throw error;
  }
}

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
    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(`${path}${suffix}`, { force: true });
    }

    connection = connect(path, migrationsFolder);
  }

  return {
    candles: candleStore(connection.db),
    close: () => connection.client.close(),
  };
}

export type Cache = ReturnType<typeof openCache>;
