import * as z from "zod";

import { orderRequestSchema } from "@solyx/core/order";
import { ProposalSource } from "@solyx/core/order-desk";

import { proposalsChannels } from "#shared/ipc/proposals.ts";
import type { ProposalsApi } from "#shared/ipc/proposals.ts";

import { ipcModule } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const handle = ipcModule<ProposalsApi>(proposalsChannels, {
  list: z.tuple([]),
  propose: z.tuple([orderRequestSchema, z.string()]),
  confirm: z.tuple([z.string()]),
  dismiss: z.tuple([z.string()]),
});

export function registerProposalsIpc({ desk }: Services) {
  handle("list", async () => desk.list());
  handle("propose", (order, rationale) =>
    desk.propose({ order, rationale, source: ProposalSource.User })
  );
  // The single road to broker.placeOrder. Never hand confirm to an agent as a tool.
  handle("confirm", (id) => desk.confirm(id));
  handle("dismiss", async (id) => desk.dismiss(id));
}
