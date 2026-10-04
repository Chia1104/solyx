import * as z from "zod";

import { orderRequestSchema } from "@solyx/core/order";
import { ProposalSource } from "@solyx/core/order-desk";

import { proposalsChannels } from "#shared/ipc/proposals.ts";
import type { ProposalsApi } from "#shared/ipc/proposals.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const schemas = {
  list: z.tuple([]),
  propose: z.tuple([orderRequestSchema, z.string()]),
  confirm: z.tuple([z.string()]),
  dismiss: z.tuple([z.string()]),
};

export function registerProposalsIpc({ desk }: Services) {
  bindIpc<ProposalsApi>(proposalsChannels, schemas, {
    list: async () => desk.list(),
    propose: (order, rationale) =>
      desk.propose({ order, rationale, source: ProposalSource.User }),
    // The single road to broker.placeOrder. Never hand confirm to an agent as a tool.
    confirm: (id) => desk.confirm(id),
    dismiss: async (id) => desk.dismiss(id),
  });
}
