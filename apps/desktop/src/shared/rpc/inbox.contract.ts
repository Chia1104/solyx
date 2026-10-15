import { oc, type } from "@orpc/contract";

import type { Inbox } from "../inbox.ts";

import { changesContract } from "./changes.ts";

export const inboxContract = {
  list: oc.output(type<Inbox>()),
  /** A proposal, a call waiting, research or the listings followed changed. */
  changes: changesContract,
};
