import { oc, type } from "@orpc/contract";
import * as z from "zod";

import { exitRequestSchema, orderRequestSchema } from "@solyx/core/order";
import type { TradeProposal } from "@solyx/core/order-desk";

import { forDevices } from "./access.ts";
import { changesContract } from "./changes.ts";

export const proposalsContract = {
  list: oc.meta(forDevices(true)).output(type<TradeProposal[]>()),
  /** An order, or an exit whose sale the broker sends itself once a price is reached. */
  propose: oc
    .meta(forDevices(true))
    .input(
      z.union([
        z.object({ order: orderRequestSchema, rationale: z.string() }),
        z.object({ exit: exitRequestSchema, rationale: z.string() }),
      ])
    )
    .output(type<TradeProposal>()),
  confirm: oc.input(z.string()).output(type<TradeProposal>()),
  dismiss: oc
    .meta(forDevices(true))
    .input(z.string())
    .output(type<TradeProposal>()),
  /** Has the broker stop watching a proposal's exit. */
  cancelExit: oc.input(z.string()).output(type<TradeProposal>()),
  /** Looks at the broker for the orders of proposals whose sending went unanswered. */
  reconcile: oc.meta(forDevices(true)).output(type<void>()),
  /** A proposal was made or changed; the account may have changed with it. */
  changes: changesContract,
};
