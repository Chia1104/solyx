import type { Embedder } from "@solyx/core/embedding";
import type { FactReader } from "@solyx/core/forecast";
import type { Fundamentals } from "@solyx/core/fundamentals";
import { Market, exchangeDate, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { MarketData } from "@solyx/core/market-data";
import type { NewsStore } from "@solyx/core/news";
import type { ClaimAuditor } from "@solyx/core/report";
import { ResearchDesk } from "@solyx/core/research";
import { Session } from "@solyx/core/session";
import type { ResearchData } from "@solyx/db/research";
import { DAY_MS, MINUTE_MS } from "@solyx/utils/date";

import type { ScheduledWork } from "../../scheduler.ts";
import type { Diagnostics } from "../telemetry/diagnostics.ts";

// The news a report's falsifiers are watched against: what a collection reaches back for.
const WATCHED_MS = 7 * DAY_MS;

// Often enough that a report's event reads as passed, and a forecast as settled, within a minute
// of its exchange's day turning or its session closing.
const CLOCK_CHECK_MS = MINUTE_MS;

/**
 * The agent's research as the main process shares it: the one `ResearchDesk` over the research
 * database, which tells `onChange` after every revision, reading of falsifiers against the news,
 * forecast and settlement, as an exchange's day turns or its regular session ends, and after
 * clearing it all, so every window reads it again.
 */
export function createResearch(
  data: ResearchData,
  {
    news,
    embedder,
    diagnostics,
    sessions,
    ...sources
  }: {
    marketData: Pick<MarketData, "candles">;
    fundamentals: Pick<Fundamentals, "statements" | "dividends">;
    auditor: () => Promise<ClaimAuditor | undefined>;
    reader: () => Promise<FactReader | undefined>;
    news: Pick<NewsStore, "list">;
    /** Only a model on this computer, since a report is the user's own. */
    embedder: () => Embedder | undefined;
    diagnostics: Pick<Diagnostics, "recovered">;
    /** The session each market is in now. */
    sessions: () => Promise<Record<Market, Session>>;
    /** @default Date.now */
    now?: () => number;
  },
  onChange: () => void
) {
  const { now = Date.now } = sources;

  const desk = new ResearchDesk({
    store: data.store,
    ...sources,
    embedder,
    onChange,
  });

  /** Each market's day on its exchange's calendar, and whether its regular session is open. */
  async function exchangeClock() {
    const open = await sessions();

    return Object.values(Market)
      .map(
        (market) =>
          `${exchangeDate(market, new Date(now()))}:${open[market] === Session.Regular}`
      )
      .join(" ");
  }

  let clock: string | undefined;

  return {
    desk,

    /**
     * Tells `onChange` as an exchange's day turns, which passes a report's events, and as its
     * regular session opens or closes, after which a forecast reads as settled; nothing else
     * tells of either.
     */
    work: {
      everyMs: CLOCK_CHECK_MS,
      async run() {
        const read = await exchangeClock();
        const changed = clock !== undefined && read !== clock;

        clock = read;

        if (changed) onChange();
      },
    } satisfies ScheduledWork,

    /**
     * Reads the listing's falsifiers against the week's news, as it is collected; a failure is
     * logged, and the items are read again with the next collection.
     */
    async watch(symbol: SymbolRef) {
      const since = new Date(now() - WATCHED_MS);

      try {
        await desk.watch(symbol, (space) => news.list(symbol, since, space));
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
