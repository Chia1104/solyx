import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { omit } from "es-toolkit";

import type { Forecast } from "@solyx/core/forecast";
import type { SymbolRef } from "@solyx/core/market";
import type { ResearchStore } from "@solyx/core/research";

import { connect } from "./connection.ts";
import { databaseBytes } from "./database-file.ts";
import { forecasts, reports } from "./research-schema.ts";

function toForecast(row: typeof forecasts.$inferSelect): Forecast {
  return { ...row.forecast, outcome: row.outcome };
}

function researchStore(db: NodeSQLiteDatabase): ResearchStore {
  return {
    report: ({ market, symbol }) =>
      db
        .select({ report: reports.report })
        .from(reports)
        .where(and(eq(reports.market, market), eq(reports.symbol, symbol)))
        .orderBy(desc(reports.revision))
        .limit(1)
        .get()?.report,

    addReport(report) {
      db.insert(reports)
        .values({ ...report.symbol, revision: report.revision, report })
        .run();
    },

    forecast(id) {
      const row = db.select().from(forecasts).where(eq(forecasts.id, id)).get();

      return row && toForecast(row);
    },

    forecasts: (listing?: SymbolRef) =>
      db
        .select()
        .from(forecasts)
        .where(
          listing &&
            and(
              eq(forecasts.market, listing.market),
              eq(forecasts.symbol, listing.symbol)
            )
        )
        .orderBy(asc(forecasts.seq))
        .all()
        .map(toForecast),

    addForecast(forecast) {
      db.insert(forecasts)
        .values({
          id: forecast.id,
          market: forecast.instrument.market,
          symbol: forecast.instrument.symbol,
          anchorDate: forecast.anchor.date,
          forecast: omit(forecast, ["outcome"]),
          outcome: forecast.outcome,
        })
        .run();
    },

    settle(id, outcome) {
      // An outcome is kept once: later bars never rewrite how a forecast came out.
      db.update(forecasts)
        .set({ outcome })
        .where(and(eq(forecasts.id, id), isNull(forecasts.outcome)))
        .run();
    },
  };
}

export interface ResearchUsage {
  /** The file on disk, with its write-ahead log. */
  bytes: number;
  /** Listings with a report. */
  reports: number;
  forecasts: number;
}

/**
 * The agent's research: every revision of each listing's report, and every forecast with how it
 * came out. Neither can be made again, so like the user's database it is never deleted, and a
 * file its migrations cannot open is an error. `migrationsFolder` is `migrations/research`
 * wherever the host ships it.
 */
export function openResearch(path: string, migrationsFolder: string) {
  const { client, db } = connect(path, migrationsFolder);

  return {
    store: researchStore(db),

    usage(): ResearchUsage {
      return {
        bytes: databaseBytes(path),
        reports: db
          .selectDistinct({ market: reports.market, symbol: reports.symbol })
          .from(reports)
          .all().length,
        forecasts:
          db.select({ forecasts: count() }).from(forecasts).get()?.forecasts ??
          0,
      };
    },

    /** Deletes every report and forecast and gives the space back to the disk. */
    clear() {
      db.transaction((tx) => {
        tx.delete(reports).run();
        tx.delete(forecasts).run();
      });
      // VACUUM rewrites the file through the log, so the log is truncated after it.
      client.exec("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);");
    },

    close: () => client.close(),
  };
}

export type ResearchData = ReturnType<typeof openResearch>;
