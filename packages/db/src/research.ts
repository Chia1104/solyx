import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { keyBy, omit, sortBy, uniqBy } from "es-toolkit";

import type { Forecast } from "@solyx/core/forecast";
import { symbolKey } from "@solyx/core/market";
import type { Market, SymbolRef } from "@solyx/core/market";
import type { Report } from "@solyx/core/report";
import type { FalsifierCheck, ResearchStore } from "@solyx/core/research";

import { connect } from "./connection.ts";
import { databaseBytes } from "./database-file.ts";
import { anyTerm, indexedTerms } from "./full-text.ts";
import {
  falsifierChecks,
  forecasts,
  passageVectors,
  reports,
} from "./research-schema.ts";
import { vectorCache } from "./vectors.ts";

function toForecast(row: typeof forecasts.$inferSelect): Forecast {
  return { ...row.forecast, outcome: row.outcome };
}

function toCheck(row: typeof falsifierChecks.$inferSelect): FalsifierCheck {
  return {
    falsifier: row.falsifier,
    revision: row.revision,
    source: row.source,
    item: {
      id: row.itemKey,
      title: row.title,
      url: row.url,
      site: row.site,
      published:
        row.publishedAt === null || row.publishedPrecision === null
          ? null
          : {
              at: new Date(row.publishedAt),
              precision: row.publishedPrecision,
            },
    },
    support: { model: row.model, supported: row.supported },
    checkedAt: row.checkedAt,
  };
}

/** What `report_terms` holds of a revision: its listing's code and every text it carries. */
function reportTerms(report: Report) {
  return indexedTerms([
    report.symbol.symbol,
    report.thesis,
    ...[...report.drivers, ...report.risks].flatMap((argument) => [
      argument.point,
      argument.text,
      argument.quote,
      argument.source,
    ]),
    ...report.falsifiers,
    report.valuation?.basis,
    ...report.events.flatMap((event) => [
      event.label,
      event.quote,
      event.source,
    ]),
    ...Object.values(report.sections).map((part) => part.text),
  ]);
}

/** What `forecast_terms` holds of a forecast: its listing's code and every text it carries. */
function forecastTerms(forecast: Omit<Forecast, "outcome">) {
  return indexedTerms([
    forecast.instrument.symbol,
    forecast.rationale,
    forecast.contrary,
    ...forecast.claims.flatMap((claim) => [
      claim.text,
      claim.quote,
      claim.source,
    ]),
    ...forecast.scenarios.map((scenario) => scenario.label),
  ]);
}

const ofListing = (symbol: SymbolRef | undefined) =>
  symbol
    ? sql`AND market = ${symbol.market} AND symbol = ${symbol.symbol}`
    : sql``;

/** Indexes the rows kept before their full-text tables existed. */
function indexMissing(db: NodeSQLiteDatabase) {
  db.transaction((tx) => {
    for (const row of tx
      .select({ id: reports.id, report: reports.report })
      .from(reports)
      .where(sql`${reports.id} NOT IN (SELECT rowid FROM report_terms)`)
      .all()) {
      tx.run(
        sql`INSERT INTO report_terms (rowid, terms) VALUES (${row.id}, ${reportTerms(row.report)})`
      );
    }

    for (const row of tx
      .select({ seq: forecasts.seq, forecast: forecasts.forecast })
      .from(forecasts)
      .where(sql`${forecasts.seq} NOT IN (SELECT rowid FROM forecast_terms)`)
      .all()) {
      tx.run(
        sql`INSERT INTO forecast_terms (rowid, terms) VALUES (${row.seq}, ${forecastTerms(row.forecast)})`
      );
    }
  });
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
      db.transaction((tx) => {
        const row = tx
          .insert(reports)
          .values({ ...report.symbol, revision: report.revision, report })
          .returning({ id: reports.id })
          .get();

        tx.run(
          sql`INSERT INTO report_terms (rowid, terms) VALUES (${row.id}, ${reportTerms(report)})`
        );
      });
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
      db.transaction((tx) => {
        const row = tx
          .insert(forecasts)
          .values({
            id: forecast.id,
            market: forecast.instrument.market,
            symbol: forecast.instrument.symbol,
            anchorDate: forecast.anchor.date,
            forecast: omit(forecast, ["outcome"]),
            outcome: forecast.outcome,
          })
          .returning({ seq: forecasts.seq })
          .get();

        tx.run(
          sql`INSERT INTO forecast_terms (rowid, terms) VALUES (${row.seq}, ${forecastTerms(forecast)})`
        );
      });
    },

    settle(id, outcome) {
      // An outcome is kept once: later bars never rewrite how a forecast came out.
      db.update(forecasts)
        .set({ outcome })
        .where(and(eq(forecasts.id, id), isNull(forecasts.outcome)))
        .run();
    },

    falsifierChecks: ({ market, symbol }, revision) =>
      db
        .select()
        .from(falsifierChecks)
        .where(
          and(
            eq(falsifierChecks.market, market),
            eq(falsifierChecks.symbol, symbol),
            eq(falsifierChecks.revision, revision)
          )
        )
        .orderBy(asc(falsifierChecks.id))
        .all()
        .map(toCheck),

    addFalsifierCheck({ market, symbol }, check) {
      const { item, support } = check;

      // A check is kept once: reading the same falsifier against the same item again changes nothing.
      db.insert(falsifierChecks)
        .values({
          market,
          symbol,
          revision: check.revision,
          falsifier: check.falsifier,
          source: check.source,
          itemKey: item.id,
          title: item.title,
          url: item.url,
          site: item.site,
          publishedAt: item.published?.at.getTime() ?? null,
          publishedPrecision: item.published?.precision ?? null,
          model: support.model,
          supported: support.supported,
          checkedAt: check.checkedAt,
        })
        .onConflictDoNothing()
        .run();
    },

    reports: (symbol) =>
      db
        .select({ report: reports.report })
        .from(reports)
        .where(
          symbol &&
            and(
              eq(reports.market, symbol.market),
              eq(reports.symbol, symbol.symbol)
            )
        )
        .orderBy(asc(reports.id))
        .all()
        .map((row) => row.report),

    ...vectorCache(db, passageVectors),

    searchReports(query, limit, symbol) {
      const match = anyTerm(query);

      if (match === null) return [];

      const matched = db.all<{
        id: number;
        market: Market;
        symbol: string;
        revision: number;
        score: number;
      }>(
        sql`SELECT id, market, symbol, revision, bm25(report_terms) AS score
          FROM report_terms JOIN reports ON reports.id = report_terms.rowid
          WHERE report_terms MATCH ${match} ${ofListing(symbol)}`
      );

      // Each listing's newest revision that matches, ranked by how well it matches.
      const ranked = sortBy(
        uniqBy(sortBy(matched, [(row) => -row.revision]), symbolKey),
        [(row) => row.score, (row) => -row.id]
      ).slice(0, limit);

      const found = keyBy(
        db
          .select({ id: reports.id, report: reports.report })
          .from(reports)
          .where(
            inArray(
              reports.id,
              ranked.map((row) => row.id)
            )
          )
          .all(),
        (row) => row.id
      );

      return ranked.flatMap(({ id }) => {
        const row = found[id];

        return row ? [row.report] : [];
      });
    },

    searchForecasts(query, limit, symbol) {
      const match = anyTerm(query);

      if (match === null) return [];

      const ranked = db.all<{ seq: number }>(
        sql`SELECT seq FROM forecast_terms
          JOIN forecasts ON forecasts.seq = forecast_terms.rowid
          WHERE forecast_terms MATCH ${match} ${ofListing(symbol)}
          ORDER BY bm25(forecast_terms), seq DESC
          LIMIT ${limit}`
      );

      const found = keyBy(
        db
          .select()
          .from(forecasts)
          .where(
            inArray(
              forecasts.seq,
              ranked.map((row) => row.seq)
            )
          )
          .all(),
        (row) => row.seq
      );

      return ranked.flatMap(({ seq }) => {
        const row = found[seq];

        return row ? [toForecast(row)] : [];
      });
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

  indexMissing(db);

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
        tx.delete(falsifierChecks).run();
        tx.delete(passageVectors).run();
        tx.run(
          sql`INSERT INTO report_terms (report_terms) VALUES ('delete-all')`
        );
        tx.run(
          sql`INSERT INTO forecast_terms (forecast_terms) VALUES ('delete-all')`
        );
      });
      // VACUUM rewrites the file through the log, so the log is truncated after it.
      client.exec("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);");
    },

    close: () => client.close(),
  };
}

export type ResearchData = ReturnType<typeof openResearch>;
