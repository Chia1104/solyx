import { and, asc, desc, eq } from "drizzle-orm";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { omit } from "es-toolkit";

import type { AgentSessionStore } from "@solyx/agent/transcript";
import type { SymbolRef } from "@solyx/core/market";
import type { ProposalStore, TradeProposal } from "@solyx/core/order-desk";

import { connect } from "./connection.ts";
import {
  agentMessages,
  agentSessions,
  proposals,
  watchlist,
} from "./user-schema.ts";

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

export type WatchlistStore = ReturnType<typeof watchlistStore>;

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

function agentSessionStore(db: NodeSQLiteDatabase): AgentSessionStore {
  const session = {
    id: agentSessions.id,
    title: agentSessions.title,
    createdAt: agentSessions.createdAt,
    updatedAt: agentSessions.updatedAt,
  };

  return {
    list: () =>
      db
        .select(session)
        .from(agentSessions)
        .orderBy(desc(agentSessions.updatedAt), desc(agentSessions.seq))
        .all(),

    get: (id) =>
      db
        .select(session)
        .from(agentSessions)
        .where(eq(agentSessions.id, id))
        .get(),

    create(value) {
      db.insert(agentSessions).values(value).run();
    },

    update(value) {
      db.update(agentSessions)
        .set(value)
        .where(eq(agentSessions.id, value.id))
        .run();
    },

    delete(id) {
      // Its messages go with it through the foreign key.
      db.delete(agentSessions).where(eq(agentSessions.id, id)).run();
    },

    entries: (sessionId) =>
      db
        .select({ id: agentMessages.id, message: agentMessages.message })
        .from(agentMessages)
        .where(eq(agentMessages.sessionId, sessionId))
        .orderBy(asc(agentMessages.seq))
        .all(),

    append(sessionId, entry) {
      db.insert(agentMessages)
        .values({ sessionId, ...entry })
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
    agentSessions: agentSessionStore(connection.db),
    close: () => connection.client.close(),
  };
}

export type UserData = ReturnType<typeof openUserData>;
