import { MemoryPublisher } from "@orpc/publisher/memory";
import { noop, throttle } from "es-toolkit";

import { symbolKey } from "@solyx/core/market";
import type { Market, SymbolRef } from "@solyx/core/market";
import type { Depth } from "@solyx/core/market-data";

import type { Diagnostics } from "../telemetry/diagnostics.ts";

import type { LiveStream } from "./live-stream.ts";

// A busy book changes several times a second; windows hear about it at most four times.
const FLUSH_MS = 250;

/** How often a book the stream cannot take is read instead, through its market's regular session. */
export const DEPTH_POLL_MS = 5_000;

interface LiveDepthOptions {
  stream: LiveStream;
  /** The source's depth of `symbol` now; `null` where no source covers the market or it keeps no book. */
  read(symbol: SymbolRef): Promise<Depth | null>;
  /** Whether `market` is in its regular session, the only time a book changes enough to read it again. */
  trading(market: Market): Promise<boolean>;
  /** Where a read that failed is logged; it leaves the depth last known. */
  diagnostics: Pick<Diagnostics, "recovered">;
}

interface Followed {
  symbol: SymbolRef;
  /** `undefined` until the first read or push. */
  depth: Depth | null | undefined;
  senders: Set<(depth: Depth | null) => void>;
  stop: () => void;
  flush: () => void;
}

/**
 * Keeps the depth of every listing a window follows, one watch per listing, from the live stream
 * where it takes the listing and otherwise read every `DEPTH_POLL_MS` through the regular session.
 */
export function createLiveDepth(options: LiveDepthOptions) {
  const { stream } = options;
  const followed = new Map<string, Followed>();

  function update(state: Followed, depth: Depth | null) {
    // A read that lands after a newer push leaves the push.
    if (depth && state.depth && depth.time < state.depth.time) return;

    state.depth = depth;
    state.flush();
  }

  async function read(state: Followed) {
    try {
      update(state, await options.read(state.symbol));
    } catch (error) {
      options.diagnostics.recovered(error, "market.depth", {
        "solyx.listing": symbolKey(state.symbol),
      });
    }
  }

  function poll(state: Followed) {
    let wasTrading = false;

    const timer = setInterval(() => {
      void options.trading(state.symbol.market).then((trading) => {
        // The read as the session ends brings in its closing auction.
        if (trading || wasTrading) void read(state);

        wasTrading = trading;
      });
    }, DEPTH_POLL_MS);

    return () => clearInterval(timer);
  }

  async function start(state: Followed) {
    const opened = await stream.ensure().catch(() => undefined);

    // Every window stopped following while the stream opened.
    if (followed.get(symbolKey(state.symbol)) !== state) return;

    // Depth replays nothing as it is subscribed, so the source is read once for where it stands now.
    void read(state);

    state.stop =
      opened?.watchDepth(state.symbol, (depth) => update(state, depth)) ??
      poll(state);
  }

  stream.onRestart(async () => {
    await Promise.all(
      [...followed.values()].map((state) => {
        state.stop();

        return start(state);
      })
    );
  });

  return {
    /**
     * `symbol`'s depth as it changes: where it stands first, then each change, until `signal`
     * aborts or the caller stops reading.
     */
    async *follow(
      symbol: SymbolRef,
      signal?: AbortSignal
    ): AsyncGenerator<Depth | null> {
      const key = symbolKey(symbol);
      const pushes = new MemoryPublisher<{ depth: { depth: Depth | null } }>();

      const sender = (depth: Depth | null) =>
        void pushes.publish("depth", { depth });

      // Read from before the watch, whose first push may come at once.
      const pushed = pushes.subscribe("depth", { signal });
      let state = followed.get(key);

      if (state) {
        state.senders.add(sender);

        if (state.depth !== undefined) sender(state.depth);
      } else {
        const created: Followed = {
          symbol,
          depth: undefined,
          senders: new Set([sender]),
          stop: noop,
          flush: throttle(() => {
            if (created.depth === undefined) return;

            for (const send of created.senders) send(created.depth);
          }, FLUSH_MS),
        };

        followed.set(key, created);
        state = created;
        void start(created);
      }

      const following = state;

      try {
        for await (const { depth } of pushed) yield depth;
      } finally {
        following.senders.delete(sender);

        if (following.senders.size === 0) {
          following.stop();
          followed.delete(key);
        }

        await pushed.return();
      }
    },
  };
}
