import { and, asc, eq } from "drizzle-orm";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { omit } from "es-toolkit";

import type { SymbolRef } from "@solyx/core/market";
import type { AccountSnapshot } from "@solyx/core/order";
import type { ProposalStore, TradeProposal } from "@solyx/core/order-desk";

import { connect } from "./connection.ts";
import { paperAccount, proposals, watchlist } from "./user-schema.ts";

// The paper account is a single row.
const PAPER_ACCOUNT_ID = 1;

interface PaperAccount extends AccountSnapshot {
  orders: number;
}

function watchlistStore(db: NodeSQLiteDatabase) {
  const listing = (ref: SymbolRef) =>
    and(eq(watchlist.market, ref.market), eq(watchlist.symbol, ref.symbol));

  return {
    /** Watched listings in the order they were added. */
    list: (): SymbolRef[] =>
      db
        .select({ market: watchlist.market, symbol: watchlist.symbol })
        .from(watchlist)
        .orderBy(asc(watchlist.id))
        .all(),

    /** Appends a listing; one already watched keeps its place. */
    add(ref: SymbolRef) {
      db.insert(watchlist).values(ref).onConflictDoNothing().run();
    },

    remove(ref: SymbolRef) {
      db.delete(watchlist).where(listing(ref)).run();
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
    close: () => connection.client.close(),
  };
}

export type UserData = ReturnType<typeof openUserData>;
