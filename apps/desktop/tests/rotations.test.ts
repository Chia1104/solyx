import { expect, test, vi } from "vite-plus/test";

import type { Candle } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { ROTATION_PERIODS, RotationInterval } from "@solyx/core/rotation";
import { SectorGroup, TW_SECTOR_INDICES, TwSector } from "@solyx/core/sectors";
import { MINUTE_MS } from "@solyx/utils/date";

import { createRotations } from "../src/main/modules/market/rotations.ts";

const NOW = new Date("2026-09-29T10:00:00+08:00");

const TSMC = { market: Market.TW, symbol: "2330" };

const taipei = (date: string) => Date.parse(`${date}T00:00:00+08:00`) / 1000;

const bar = (date: string, close: number): Candle => ({
  time: taipei(date),
  open: close,
  high: close,
  low: close,
  close,
  volume: 0,
});

/** Flat index bars over the last sessions of September. */
const TAIEX = [
  bar("2026-09-24", 23_000),
  bar("2026-09-25", 23_000),
  bar("2026-09-28", 23_000),
  bar("2026-09-29", 23_000),
];

/** Every reading of a listing with too few bars, in the order the module gives them. */
const EMPTY_READINGS = Object.values(RotationInterval).flatMap((interval) =>
  ROTATION_PERIODS[interval].map((period) => ({
    interval,
    period,
    trail: [],
    quadrant: null,
    transition: null,
  }))
);

function setup() {
  const candlesSince = vi.fn(
    async ({ symbol }: SymbolRef, _since: string): Promise<Candle[]> =>
      symbol === "IX0001" ? TAIEX : []
  );

  const clock = { now: NOW };

  const rotations = createRotations({
    candlesSince,
    sourceId: async (market) => (market === Market.TW ? "fake" : null),
    company: async ({ symbol }) =>
      symbol === "2330"
        ? { industry: { code: "24", name: "半導體業" }, shares: 1 }
        : null,
    now: () => clock.now,
  });

  return { rotations, candlesSince, clock };
}

test("sectors read the TAIEX's and each index's daily bars once and keep them a minute", async () => {
  const { rotations, candlesSince, clock } = setup();

  const set = await rotations.sectors();

  expect(candlesSince).toHaveBeenCalledTimes(TW_SECTOR_INDICES.length + 1);
  // Three years back, so a year of weeks can be read twice over.
  expect(candlesSince).toHaveBeenCalledWith(
    { market: Market.TW, symbol: "IX0001" },
    "2023-09-30"
  );
  expect(set?.asOf).toBe("2026-09-29");
  expect(set?.sessions).toEqual([
    "2026-09-24",
    "2026-09-25",
    "2026-09-28",
    "2026-09-29",
  ]);
  expect(set?.entries.find((each) => each.symbol === "IX0028")).toEqual({
    sector: TwSector.Semiconductors,
    group: SectorGroup.Electronics,
    symbol: "IX0028",
    readings: EMPTY_READINGS,
  });

  clock.now = new Date(NOW.getTime() + MINUTE_MS - 1);
  const back = await rotations.sectors("2026-09-25");

  expect(candlesSince).toHaveBeenCalledTimes(TW_SECTOR_INDICES.length + 1);
  expect(back?.asOf).toBe("2026-09-25");
  expect(back?.sessions).toEqual(set?.sessions);
});

test("listings read each listing's daily bars and its market's index once, with the markets' sessions", async () => {
  const { rotations, candlesSince } = setup();

  const symbols = [TSMC, { market: Market.TW, symbol: "2454" }];
  const set = await rotations.listings(symbols);

  expect(candlesSince).toHaveBeenCalledTimes(3);
  expect(set.entries.map(({ symbol }) => symbol)).toEqual(symbols);
  expect(set.entries[0].readings).toEqual(EMPTY_READINGS);
  expect(set.sessions).toHaveLength(4);
  expect(set.asOf).toBe("2026-09-29");
});

test("a listing is read against its own sector's index where its industry has one", async () => {
  const { rotations, candlesSince } = setup();

  const view = await rotations.listing(TSMC);

  expect(view.index.name).toBe("TAIEX");
  expect(view.sector).toEqual({
    sector: TwSector.Semiconductors,
    symbol: "IX0028",
    readings: EMPTY_READINGS,
  });
  expect(candlesSince).toHaveBeenCalledWith(
    { market: Market.TW, symbol: "IX0028" },
    "2023-09-30"
  );

  const other = await rotations.listing({ market: Market.TW, symbol: "2454" });

  expect(other.sector).toBeNull();
});

test("sectors are null while no source covers Taiwan", async () => {
  const rotations = createRotations({
    candlesSince: async () => [],
    sourceId: async () => null,
    company: async () => null,
  });

  expect(await rotations.sectors()).toBeNull();
});
