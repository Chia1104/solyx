import { oc, type } from "@orpc/contract";

import type { TradeProposal } from "@solyx/core/order-desk";
import type { ReportBacklog } from "@solyx/core/research";

import { changesContract } from "./changes.ts";

/** A conversation with a call waiting for the user to allow it. */
export interface Approval {
  sessionId: string;
  /** Empty until the conversation's first message names it. */
  title: string;
}

/** What waits for the user, each until they handle it. */
export interface Inbox {
  /** Proposals waiting for the user to confirm them, oldest first. */
  proposals: TradeProposal[];
  approvals: Approval[];
  /**
   * The reports of the listings the user holds and watches that have news read as stating a
   * falsifier or an event gone by, which a revision takes in.
   */
  reports: ReportBacklog[];
}

export const inboxContract = {
  list: oc.output(type<Inbox>()),
  /** A proposal, a call waiting, research or the listings followed changed. */
  changes: changesContract,
};
