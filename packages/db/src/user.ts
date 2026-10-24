import { and, asc, desc, eq, gte, inArray, max } from "drizzle-orm";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { clamp, omit } from "es-toolkit";

import type { BacktestMetrics, RollingSummary } from "@solyx/core/backtest";
import type { WatchedExitLeg } from "@solyx/core/broker";
import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { AccountSnapshot, Fill } from "@solyx/core/order";
import type { ProposalStore, TradeProposal } from "@solyx/core/order-desk";
import type { ScheduleStore } from "@solyx/core/schedule";
import type { ThemeItem, ThemeStore } from "@solyx/core/theme";

import { connect } from "./connection.ts";
import {
  backtestRuns,
  paperAccount,
  paperExitLegs,
  paperFills,
  proposals,
  scheduledTasks,
  themeItems,
  themeReadings,
  themes,
  watchlist,
} from "./user-schema.ts";

// The paper account is a single row.
const PAPER_ACCOUNT_ID = 1;

interface PaperAccount extends AccountSnapshot {
  orders: number;
}

interface PaperFill extends Fill {
  tag: string | null;
  limitPrice: number | null;
}

interface PaperExitLeg extends WatchedExitLeg {
  tag: string;
  until: string;
}

function watchlistStore(db: NodeSQLiteDatabase) {
  const listing = (ref: SymbolRef) =>
    and(eq(watchlist.market, ref.market), eq(watchlist.symbol, ref.symbol));

  const list = (from: Pick<NodeSQLiteDatabase, "select"> = db): SymbolRef[] =>
    from
      .select({ market: watchlist.market, symbol: watchlist.symbol })
      .from(watchlist)
      .orderBy(asc(watchlist.position), asc(watchlist.id))
      .all();

  return {
    /** Watched listings in the user's order. */
    list: () => list(),

    /** Appends a listing; one already watched keeps its place. */
    add(ref: SymbolRef) {
      const last = db
        .select({ position: max(watchlist.position) })
        .from(watchlist)
        .get()?.position;

      db.insert(watchlist)
        .values({ ...ref, position: (last ?? -1) + 1 })
        .onConflictDoNothing()
        .run();
    },

    /** Moves a watched listing to `index` among the others; one not watched changes nothing. */
    move(ref: SymbolRef, index: number) {
      db.transaction((tx) => {
        const listings = list(tx);

        const others = listings.filter(
          (each) => symbolKey(each) !== symbolKey(ref)
        );

        if (others.length === listings.length) return;

        others
          .toSpliced(clamp(index, 0, others.length), 0, ref)
          .forEach((each, position) => {
            tx.update(watchlist).set({ position }).where(listing(each)).run();
          });
      });
    },

    remove(ref: SymbolRef) {
      db.delete(watchlist).where(listing(ref)).run();
    },

    clear() {
      db.delete(watchlist).run();
    },
  };
}

function toProposal(row: typeof proposals.$inferSelect): TradeProposal {
  const { brokerOrderId, failure, exit, exitRefs, exitEnded, ...rest } = omit(
    row,
    ["seq"]
  );

  const proposal: TradeProposal = rest;

  if (brokerOrderId !== null) proposal.brokerOrderId = brokerOrderId;

  if (failure !== null) proposal.failure = failure;

  if (exit !== null) proposal.exit = exit;

  if (exitRefs !== null) proposal.exitRefs = exitRefs;

  if (exitEnded !== null) proposal.exitEnded = exitEnded;

  return proposal;
}

function proposalStore(db: NodeSQLiteDatabase): ProposalStore {
  return {
    list: () =>
      db
        .select()
        .from(proposals)
        .orderBy(asc(proposals.seq))
        .all()
        .map(toProposal),

    get(id) {
      const row = db.select().from(proposals).where(eq(proposals.id, id)).get();

      return row && toProposal(row);
    },

    add(proposal) {
      db.insert(proposals).values(proposal).run();
    },

    update(proposal) {
      db.update(proposals)
        .set({
          ...proposal,
          brokerOrderId: proposal.brokerOrderId ?? null,
          failure: proposal.failure ?? null,
          exit: proposal.exit ?? null,
          exitRefs: proposal.exitRefs ?? null,
          exitEnded: proposal.exitEnded ?? null,
        })
        .where(eq(proposals.id, proposal.id))
        .run();
    },
  };
}

function paperAccountStore(db: NodeSQLiteDatabase) {
  return {
    /** `undefined` before the account's first order. */
    read(): PaperAccount | undefined {
      const row = db.select().from(paperAccount).get();

      return row && omit(row, ["id"]);
    },

    /**
     * Keeps the account as an order left it, and the order's fill, in one transaction, with the
     * exit legs `ended` dropped where the order was an exit's sale.
     */
    write(
      account: PaperAccount,
      fill: PaperFill,
      ended: readonly string[] = []
    ) {
      db.transaction((tx) => {
        if (ended.length > 0) {
          tx.delete(paperExitLegs)
            .where(inArray(paperExitLegs.ref, [...ended]))
            .run();
        }

        tx.insert(paperAccount)
          .values({ id: PAPER_ACCOUNT_ID, ...account })
          .onConflictDoUpdate({ target: paperAccount.id, set: account })
          .run();

        const { instrument, ...rest } = fill;

        tx.insert(paperFills)
          .values({ ...rest, ...instrument })
          .run();
      });
    },

    /** The exit legs the account watches, oldest first. */
    exitLegs(): PaperExitLeg[] {
      return db
        .select()
        .from(paperExitLegs)
        .orderBy(asc(paperExitLegs.seq))
        .all()
        .map(({ market, symbol, ...row }) => ({
          ...omit(row, ["seq"]),
          instrument: { market, symbol },
        }));
    },

    /** Keeps an exit's legs, all of them or none. */
    addExitLegs(legs: readonly PaperExitLeg[]) {
      db.transaction((tx) => {
        for (const { instrument, ...leg } of legs) {
          tx.insert(paperExitLegs)
            .values({ ...leg, ...instrument })
            .run();
        }
      });
    },

    removeExitLegs(refs: readonly string[]) {
      if (refs.length === 0) return;

      db.delete(paperExitLegs)
        .where(inArray(paperExitLegs.ref, [...refs]))
        .run();
    },

    /** The fills from `since`, UTC milliseconds, on, oldest first. */
    fills(since: number): PaperFill[] {
      return db
        .select()
        .from(paperFills)
        .where(gte(paperFills.filledAt, since))
        .orderBy(asc(paperFills.seq))
        .all()
        .map(({ market, symbol, ...row }) => ({
          ...omit(row, ["seq"]),
          instrument: { market, symbol },
        }));
    },
  };
}

function scheduleStore(db: NodeSQLiteDatabase): ScheduleStore {
  return {
    list: () =>
      db
        .select()
        .from(scheduledTasks)
        .orderBy(asc(scheduledTasks.seq))
        .all()
        .map((row) => omit(row, ["seq"])),

    get(id) {
      const row = db
        .select()
        .from(scheduledTasks)
        .where(eq(scheduledTasks.id, id))
        .get();

      return row && omit(row, ["seq"]);
    },

    save(task) {
      db.insert(scheduledTasks)
        .values(task)
        .onConflictDoUpdate({ target: scheduledTasks.id, set: task })
        .run();
    },

    remove(id) {
      db.delete(scheduledTasks).where(eq(scheduledTasks.id, id)).run();
    },
  };
}

function toThemeItem(row: typeof themeItems.$inferSelect): ThemeItem {
  return {
    id: row.key,
    url: row.url,
    title: row.title,
    snippet: row.snippet,
    site: row.site,
    published:
      row.publishedAt === null || row.publishedPrecision === null
        ? null
        : { at: new Date(row.publishedAt), precision: row.publishedPrecision },
    foundAt: row.foundAt,
  };
}

function themeStore(db: NodeSQLiteDatabase): ThemeStore {
  const toTheme = ({
    id,
    theme,
    createdAt,
    updatedAt,
  }: typeof themes.$inferSelect) => ({ ...theme, id, createdAt, updatedAt });

  return {
    list: () =>
      db.select().from(themes).orderBy(asc(themes.seq)).all().map(toTheme),

    get(id) {
      const row = db.select().from(themes).where(eq(themes.id, id)).get();

      return row && toTheme(row);
    },

    save({ id, createdAt, updatedAt, ...theme }) {
      db.insert(themes)
        .values({ id, theme, createdAt, updatedAt })
        .onConflictDoUpdate({ target: themes.id, set: { theme, updatedAt } })
        .run();
    },

    remove(id) {
      db.delete(themes).where(eq(themes.id, id)).run();
    },

    items: (themeId, limit) =>
      db
        .select()
        .from(themeItems)
        .where(eq(themeItems.themeId, themeId))
        .orderBy(desc(themeItems.foundAt), desc(themeItems.id))
        .limit(limit)
        .all()
        .map(toThemeItem),

    addItems(themeId, items) {
      if (items.length === 0) return;

      db.insert(themeItems)
        .values(
          items.map(({ id, published, ...item }) => ({
            ...item,
            themeId,
            key: id,
            publishedAt: published?.at.getTime() ?? null,
            publishedPrecision: published?.precision ?? null,
          }))
        )
        .onConflictDoNothing()
        .run();
    },

    readings: (themeId) =>
      db
        .select()
        .from(themeReadings)
        .where(eq(themeReadings.themeId, themeId))
        .orderBy(asc(themeReadings.id))
        .all()
        .map(({ signpost, itemKey, model, supported, checkedAt }) => ({
          signpost,
          itemId: itemKey,
          support: { model, supported },
          checkedAt,
        })),

    addReading(themeId, { signpost, itemId, support, checkedAt }) {
      db.insert(themeReadings)
        .values({ themeId, signpost, itemKey: itemId, ...support, checkedAt })
        .onConflictDoNothing()
        .run();
    },

    collectedAt: (themeId) =>
      db
        .select({ collectedAt: themes.collectedAt })
        .from(themes)
        .where(eq(themes.id, themeId))
        .get()?.collectedAt ?? null,

    markCollected(themeId, at) {
      db.update(themes)
        .set({ collectedAt: at })
        .where(eq(themes.id, themeId))
        .run();
    },
  };
}

/** A backtest a window ran, its request as its owner wrote it. */
export interface BacktestRun {
  id: string;
  ranAt: number;
  request: unknown;
  headline: BacktestMetrics | RollingSummary | null;
}

/** The backtests windows ran, newest first, at most as many as each recording keeps. */
function backtestRunStore(db: NodeSQLiteDatabase) {
  return {
    list: (): BacktestRun[] =>
      db
        .select()
        .from(backtestRuns)
        .orderBy(desc(backtestRuns.ranAt))
        .all()
        .map((row) => omit(row, ["key"])),

    get(id: string): BacktestRun | undefined {
      const row = db
        .select()
        .from(backtestRuns)
        .where(eq(backtestRuns.id, id))
        .get();

      return row && omit(row, ["key"]);
    },

    /**
     * Keeps a run under `key`, its request as one string: a request run before keeps its id and
     * takes the new time and headline. Past `keep` runs, the oldest go, in the same transaction.
     */
    record(key: string, run: BacktestRun, keep: number): BacktestRun {
      return db.transaction((tx) => {
        tx.insert(backtestRuns)
          .values({ ...run, key })
          .onConflictDoUpdate({
            target: backtestRuns.key,
            set: { ranAt: run.ranAt, headline: run.headline },
          })
          .run();

        const stale = tx
          .select({ id: backtestRuns.id })
          .from(backtestRuns)
          .orderBy(desc(backtestRuns.ranAt))
          .all()
          .slice(keep)
          .map(({ id }) => id);

        if (stale.length > 0) {
          tx.delete(backtestRuns).where(inArray(backtestRuns.id, stale)).run();
        }

        const kept = tx
          .select()
          .from(backtestRuns)
          .where(eq(backtestRuns.key, key))
          .get();

        return kept ? omit(kept, ["key"]) : run;
      });
    },

    remove(id: string) {
      db.delete(backtestRuns).where(eq(backtestRuns.id, id)).run();
    },

    clear() {
      db.delete(backtestRuns).run();
    },
  };
}

export type BacktestRunStore = ReturnType<typeof backtestRunStore>;

/**
 * The user's database, holding what cannot be fetched again. It is never deleted, so a
 * file its migrations cannot open is an error. `migrationsFolder` is `migrations/user`
 * wherever the host ships it.
 */
export function openUserData(path: string, migrationsFolder: string) {
  // A proposal is marked as sending before its order goes out, and the order desk trusts that mark
  // to never send it again, so a power loss must not take the mark back.
  const connection = connect(path, migrationsFolder, { durable: true });

  return {
    watchlist: watchlistStore(connection.db),
    proposals: proposalStore(connection.db),
    paperAccount: paperAccountStore(connection.db),
    schedules: scheduleStore(connection.db),
    themes: themeStore(connection.db),
    backtestRuns: backtestRunStore(connection.db),
    close: () => connection.client.close(),
  };
}

export type UserData = ReturnType<typeof openUserData>;
