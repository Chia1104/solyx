import { oc, type } from "@orpc/contract";
import * as z from "zod";

import { orderRequestSchema } from "@solyx/core/order";
import type { TradeProposal } from "@solyx/core/order-desk";

import { changesContract } from "./changes.ts";

const proposalIdSchema = z.object({ id: z.string() });

export const proposalsContract = {
  list: oc.output(type<TradeProposal[]>()),
  propose: oc
    .input(z.object({ order: orderRequestSchema, rationale: z.string() }))
    .output(type<TradeProposal>()),
  confirm: oc.input(proposalIdSchema).output(type<TradeProposal>()),
  dismiss: oc.input(proposalIdSchema).output(type<TradeProposal>()),
  /** A proposal was made or changed; the account may have changed with it. */
  changes: changesContract,
};
