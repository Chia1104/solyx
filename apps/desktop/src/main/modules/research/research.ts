import type { Embedder } from "@solyx/core/embedding";
import type { Fundamentals } from "@solyx/core/fundamentals";
import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { MarketData } from "@solyx/core/market-data";
import type { NewsStore } from "@solyx/core/news";
import type { ClaimAuditor } from "@solyx/core/report";
import { ResearchDesk } from "@solyx/core/research";
import type { ResearchData } from "@solyx/db/research";

import type { Diagnostics } from "../telemetry/diagnostics.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

// The news a report's falsifiers are watched against: what a collection reaches back for.
const WATCHED_MS = 7 * DAY_MS;

/**
 * The agent's research as the main process shares it: the one `ResearchDesk` over the research
 * database, which tells `onChange` after every revision, forecast and settlement, and after
 * clearing it all, so every window reads it again.
 */
export function createResearch(
  data: ResearchData,
  {
    news,
    embedder,
    diagnostics,
    ...sources
  }: {
    marketData: Pick<MarketData, "candles">;
    fundamentals: Pick<Fundamentals, "statements">;
    auditor: () => Promise<ClaimAuditor | undefined>;
    news: Pick<NewsStore, "list">;
    /** Only a model on this computer, since a report is the user's own. */
    embedder: () => Embedder | undefined;
    diagnostics: Pick<Diagnostics, "recovered">;
  },
  onChange: () => void
) {
  const desk = new ResearchDesk({
    store: data.store,
    ...sources,
    embedder,
    onChange,
  });

  return {
    desk,

    /**
     * Reads the listing's falsifiers against the week's news, as it is collected; a failure is
     * logged, and the items are read again with the next collection.
     */
    async watch(symbol: SymbolRef) {
      const local = embedder();

      if (!local) return;

      const since = new Date(Date.now() - WATCHED_MS);

      try {
        await desk.watch(symbol, news.list(symbol, since, local.space), local);
      } catch (error) {
        diagnostics.recovered(error, "research.watch", {
          "solyx.listing": symbolKey(symbol),
        });
      }
    },

    usage: () => data.usage(),

    clear() {
      data.clear();
      onChange();
    },
  };
}

export type Research = ReturnType<typeof createResearch>;
