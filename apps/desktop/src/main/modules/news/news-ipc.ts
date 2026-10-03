import * as z from "zod";

import { symbolRefSchema } from "@solyx/core/market";

import { newsChannels } from "#shared/ipc/news.ts";
import type { NewsApi } from "#shared/ipc/news.ts";

import { ipcModule } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

const handle = ipcModule<NewsApi>(newsChannels, {
  records: z.tuple([symbolRefSchema, z.number().int().min(1).max(90)]),
  coverage: z.tuple([symbolRefSchema]),
});

export function registerNewsIpc({ news }: Services) {
  handle("records", async (symbol, days) =>
    news.store.list(symbol, new Date(Date.now() - days * DAY_MS))
  );

  handle("coverage", async (symbol) => {
    const health = new Map(
      news.store.sourceHealth().map((source) => [source.source, source])
    );

    const sources = await news.sources();

    return {
      collectedAt: news.store.lastCollected(symbol),
      sources: sources
        .filter((source) => source.markets.includes(symbol.market))
        .map(({ id, channel }) => ({
          id,
          channel,
          health: health.get(id) ?? null,
        })),
    };
  });
}
