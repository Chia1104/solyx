import { and, asc, desc, eq, max } from "drizzle-orm";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { clamp, omit } from "es-toolkit";

import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { AccountSnapshot } from "@solyx/core/order";
import type { ProposalStore, TradeProposal } from "@solyx/core/order-desk";
import type { ScheduleStore } from "@solyx/core/schedule";
import type { ThemeItem, ThemeStore } from "@solyx/core/theme";

import { connect } from "./connection.ts";
import {
  paperAccount,
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
  const { brokerOrderId, failure, ...rest } = omit(row, ["seq"]);
  const proposal: TradeProposal = rest;

  if (brokerOrderId !== null) proposal.brokerOrderId = brokerOrderId;

  if (failure !== null) proposal.failure = failure;

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

    write(account: PaperAccount) {
      db.insert(paperAccount)
        .values({ id: PAPER_ACCOUNT_ID, ...account })
        .onConflictDoUpdate({ target: paperAccount.id, set: account })
        .run();
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

/**
 * The user's database, holding what cannot be fetched again. It is never deleted, so a
 * file its migrations cannot open is an error. `migrationsFolder` is `migrations/user`
 * wherever the host ships it.
 */
export function openUserData(path: string, migrationsFolder: string) {
  const connection = connect(path, migrationsFolder);

  return {
    watchlist: watchlistStore(connection.db),
    proposals: proposalStore(connection.db),
    paperAccount: paperAccountStore(connection.db),
    schedules: scheduleStore(connection.db),
    themes: themeStore(connection.db),
    close: () => connection.client.close(),
  };
}

export type UserData = ReturnType<typeof openUserData>;
