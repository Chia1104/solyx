import { noop } from "es-toolkit";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import type { Depth, MarketDataStream } from "@solyx/core/market-data";

import {
  DEPTH_POLL_MS,
  createLiveDepth,
} from "../src/backend/modules/market/live-depth.ts";
import { createLiveStream } from "../src/backend/modules/market/live-stream.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

function depth(last: number, time: number): Depth {
  return {
    date: "2026-09-29",
    time,
    reference: 2460,
    open: 2470,
    high: 2485,
    low: 2465,
    last,
    average: 2476,
    volume: 1_000_000,
    volumeAtBid: 400_000,
    volumeAtAsk: 600_000,
    bids: [{ price: last - 5, shares: 87_000 }],
    asks: [{ price: last, shares: 80_000 }],
    trial: false,
  };
}

/** A stream that takes depth only while `takes` says so. */
function fakeStream(takes = true) {
  const listeners = new Map<string, (depth: Depth) => void>();

  const stream: MarketDataStream = {
    id: "fake",
    markets: [Market.TW],
    watchMinutes: () => undefined,
    watchDepth(symbol, listener) {
      if (!takes) return undefined;

      listeners.set(symbol.symbol, listener);

      return () => listeners.delete(symbol.symbol);
    },
    close: noop,
  };

  return { stream, listeners };
}

function setup({ takes = true, trading = true } = {}) {
  const streams = [fakeStream(takes)];
  const clock = { trading, read: depth(2480, 1_000) };
  const reads = vi.fn(async () => clock.read);
  const stream = createLiveStream(async () => streams.at(-1)?.stream);

  const live = createLiveDepth({
    stream,
    read: reads,
    trading: async () => clock.trading,
    diagnostics: { recovered: vi.fn() },
  });

  return { live, stream, streams, clock, reads };
}

async function settle() {
  await vi.advanceTimersByTimeAsync(300);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("a book the stream takes starts from a read, then follows its pushes, shared by every window", async () => {
  const { live, streams, reads } = setup();
  const first = live.follow(TSMC);
  const pending = first.next();

  await settle();

  expect((await pending).value).toEqual(depth(2480, 1_000));

  const second = live.follow(TSMC);
  const joined = second.next();

  await settle();

  expect((await joined).value).toEqual(depth(2480, 1_000));
  expect(reads).toHaveBeenCalledOnce();

  streams[0].listeners.get("2330")?.(depth(2485, 2_000));

  const [pushed, alsoPushed] = await Promise.all([first.next(), second.next()]);

  expect(pushed.value).toEqual(depth(2485, 2_000));
  expect(alsoPushed.value).toEqual(depth(2485, 2_000));

  await first.return(undefined);

  expect(streams[0].listeners.has("2330")).toBe(true);

  await second.return(undefined);

  expect(streams[0].listeners.has("2330")).toBe(false);
});

test("a read that lands after a newer push is dropped", async () => {
  const { live, streams, reads } = setup();
  let answer: (read: Depth) => void = noop;

  reads.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      })
  );

  const following = live.follow(TSMC);
  const pending = following.next();

  await vi.advanceTimersByTimeAsync(0);
  streams[0].listeners.get("2330")?.(depth(2490, 5_000));
  answer(depth(2480, 1_000));
  await settle();

  expect((await pending).value).toEqual(depth(2490, 5_000));

  streams[0].listeners.get("2330")?.(depth(2495, 6_000));

  expect((await following.next()).value).toEqual(depth(2495, 6_000));

  await following.return(undefined);
});

test("a book the stream cannot take is read every few seconds through the session, and once as it ends", async () => {
  const { live, clock, reads } = setup({ takes: false });
  const following = live.follow(TSMC);

  void following.next();
  await settle();
  expect(reads).toHaveBeenCalledOnce();

  await vi.advanceTimersByTimeAsync(DEPTH_POLL_MS);
  expect(reads).toHaveBeenCalledTimes(2);

  clock.trading = false;
  await vi.advanceTimersByTimeAsync(DEPTH_POLL_MS);
  expect(reads).toHaveBeenCalledTimes(3);

  await vi.advanceTimersByTimeAsync(3 * DEPTH_POLL_MS);
  expect(reads).toHaveBeenCalledTimes(3);

  await following.return(undefined);
});

test("a restart follows the book on the new stream", async () => {
  const { live, stream, streams } = setup();
  const following = live.follow(TSMC);

  void following.next();
  await settle();
  streams.push(fakeStream());
  await stream.restart();

  expect(streams[1].listeners.has("2330")).toBe(true);

  await following.return(undefined);
});
