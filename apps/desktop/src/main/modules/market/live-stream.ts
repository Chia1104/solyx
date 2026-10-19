import type { MarketDataStream } from "@solyx/core/market-data";

/**
 * The provider's live stream, opened once for every watch of bars and depth alike, since a plan
 * may allow a single connection. A restart closes it, and each watcher that had symbols on it
 * watches them again on the next one.
 */
export function createLiveStream(
  openStream: () => Promise<MarketDataStream | undefined>
) {
  const rewatchers = new Set<() => Promise<void>>();
  let stream: MarketDataStream | undefined;
  let opening: Promise<MarketDataStream | undefined> | undefined;

  /** The open stream, opening it on first use; `undefined` while no source's key is saved. */
  function ensure(): Promise<MarketDataStream | undefined> {
    if (stream) return Promise.resolve(stream);

    opening ??= open();

    return opening;
  }

  function open() {
    const attempt: Promise<MarketDataStream | undefined> = openStream().then(
      (opened) => {
        // A restart while this one opened makes its stream stale, so callers get the current one.
        if (opening !== attempt) {
          opened?.close();

          return ensure();
        }

        stream = opened;
        opening = undefined;

        return opened;
      }
    );

    // A failed open is tried again by the next caller.
    void attempt.catch(() => {
      if (opening === attempt) opening = undefined;
    });

    return attempt;
  }

  return {
    ensure,

    /** Runs `rewatch` after every restart, once the old stream is closed. */
    onRestart(rewatch: () => Promise<void>) {
      rewatchers.add(rewatch);
    },

    /** Reopens the stream, as after the provider's key changes, and has every watcher watch again. */
    async restart() {
      const previous = stream;

      stream = undefined;
      opening = undefined;
      previous?.close();

      await Promise.all([...rewatchers].map((rewatch) => rewatch()));
    },
  };
}

export type LiveStream = ReturnType<typeof createLiveStream>;
