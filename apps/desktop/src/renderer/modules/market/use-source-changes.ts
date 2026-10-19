import { useEffect, useState } from "react";

import { client, forEachEvent } from "../../app/rpc.ts";

/** A count that grows whenever the market data sources change, so a stream that depends on them follows again. */
export function useSourceChanges(): number {
  const [changes, setChanges] = useState(0);

  useEffect(() => {
    const stop = new AbortController();
    const { signal } = stop;

    void forEachEvent(
      client.market.sourceChanges(undefined, { signal }),
      () => setChanges((count) => count + 1),
      signal
    );

    return () => stop.abort();
  }, []);

  return changes;
}
