import * as z from "zod";

import { symbolRefSchema } from "@solyx/core/market";

import { fundamentalsChannels } from "#shared/ipc/fundamentals.ts";
import type { FundamentalsApi } from "#shared/ipc/fundamentals.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

import { financialTrends } from "./financial-trends.ts";

const schemas = {
  trends: z.tuple([symbolRefSchema]),
};

export function registerFundamentalsIpc({ fundamentals }: Services) {
  bindIpc<FundamentalsApi>(fundamentalsChannels, schemas, {
    trends: (symbol) => financialTrends(fundamentals, symbol),
  });
}
