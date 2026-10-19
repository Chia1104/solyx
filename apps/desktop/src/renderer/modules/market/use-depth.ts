import { useEffect, useState } from "react";

import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { Depth } from "@solyx/core/market-data";

import { client, forEachEvent } from "../../app/rpc.ts";

import { useSourceChanges } from "./use-source-changes.ts";

/**
 * `symbol`'s depth as the main process pushes it: `undefined` until the first push and `null`
 * where no source keeps a book for it. Follows again whenever the sources change.
 */
export function useDepth(symbol: SymbolRef): Depth | null | undefined {
  const [pushed, setPushed] = useState<{ key: string; depth: Depth | null }>();
  const sources = useSourceChanges();
  const { market, symbol: code } = symbol;
  const key = symbolKey(symbol);

  useEffect(() => {
    const stop = new AbortController();
    const { signal } = stop;
    const followed = { market, symbol: code };

    void forEachEvent(
      client.market.depth(followed, { signal }),
      (depth) => setPushed({ key: symbolKey(followed), depth }),
      signal
    );

    return () => stop.abort();
  }, [market, code, sources]);

  // The listing before's depth stays until this one's first push, so it is not shown for this one.
  return pushed?.key === key ? pushed.depth : undefined;
}
