import type { Fundamentals } from "@solyx/core/fundamentals";
import type { MarketData } from "@solyx/core/market-data";
import { ResearchDesk } from "@solyx/core/research";
import type { ResearchData } from "@solyx/db/research";

/**
 * The agent's research as the main process shares it: the one `ResearchDesk` over the research
 * database, which tells `onChange` after every revision, forecast and settlement, and after
 * clearing it all, so every window reads it again.
 */
export function createResearch(
  data: ResearchData,
  sources: {
    marketData: Pick<MarketData, "candles">;
    fundamentals: Pick<Fundamentals, "statements">;
  },
  onChange: () => void
) {
  return {
    desk: new ResearchDesk({ store: data.store, ...sources, onChange }),

    usage: () => data.usage(),

    clear() {
      data.clear();
      onChange();
    },
  };
}

export type Research = ReturnType<typeof createResearch>;
