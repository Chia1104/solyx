import { oc, type } from "@orpc/contract";
import * as z from "zod";

import { orderRequestSchema } from "@solyx/core/order";
import type { TradeProposal } from "@solyx/core/order-desk";

import { changesContract } from "./changes.ts";

export const proposalsContract = {
  list: oc.output(type<TradeProposal[]>()),
  propose: oc
    .input(z.object({ order: orderRequestSchema, rationale: z.string() }))
    .output(type<TradeProposal>()),
  confirm: oc.input(z.string()).output(type<TradeProposal>()),
  dismiss: oc.input(z.string()).output(type<TradeProposal>()),
  /** Looks at the broker for the orders of proposals whose sending went unanswered. */
  reconcile: oc.output(type<void>()),
  /** A proposal was made or changed; the account may have changed with it. */
  changes: changesContract,
};
