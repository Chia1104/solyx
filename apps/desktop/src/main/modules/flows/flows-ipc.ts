import * as z from "zod";

import { marketSchema, symbolRefSchema } from "@solyx/core/market";

import { flowsChannels } from "#shared/ipc/flows.ts";
import type { FlowsApi } from "#shared/ipc/flows.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const schemas = {
  listing: z.tuple([symbolRefSchema]),
  market: z.tuple([marketSchema]),
};

export function registerFlowsIpc({ flows }: Services) {
  bindIpc<FlowsApi>(flowsChannels, schemas, {
    listing: (symbol) => flows.listing(symbol),
    market: (market) => flows.market(market),
  });
}
