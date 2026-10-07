import * as z from "zod";

import { symbolRefSchema } from "@solyx/core/market";

import { researchChannels } from "#shared/ipc/research.ts";
import type { ResearchApi } from "#shared/ipc/research.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const schemas = {
  coverage: z.tuple([symbolRefSchema]),
};

// Reading only: reports and forecasts are the agent's to write, through its tools.
export function registerResearchIpc({ research }: Services) {
  bindIpc<ResearchApi>(researchChannels, schemas, {
    coverage: (symbol) => research.desk.coverage(symbol),
  });
}
