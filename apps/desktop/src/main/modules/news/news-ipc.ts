import * as z from "zod";

import { symbolRefSchema } from "@solyx/core/market";

import { newsChannels } from "#shared/ipc/news.ts";
import type { NewsApi } from "#shared/ipc/news.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

const schemas = {
  records: z.tuple([symbolRefSchema, z.number().int().min(1).max(90)]),
  coverage: z.tuple([symbolRefSchema]),
};

export function registerNewsIpc({ news }: Services) {
  bindIpc<NewsApi>(newsChannels, schemas, {
    records: async (symbol, days) =>
      news.records(symbol, new Date(Date.now() - days * DAY_MS)),
    coverage: (symbol) => news.coverage(symbol),
  });
}
