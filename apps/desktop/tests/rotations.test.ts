import { expect, test, vi } from "vite-plus/test";

import type { Candle } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { ROTATION_PERIODS, RotationInterval } from "@solyx/core/rotation";
import { SectorGroup, TW_SECTOR_INDICES, TwSector } from "@solyx/core/sectors";
import { MINUTE_MS } from "@solyx/utils/date";
import { memoryAnswers } from "@solyx/utils/fresh";

import { createRotations } from "../src/main/modules/market/rotations.ts";

const NOW = new Date("2026-09-29T10:00:00+08:00");

const TSMC = { market: Market.TW, symbol: "2330" };

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
    async (_symbol: SymbolRef, _since: string): Promise<Candle[]> => []
  );

  const clock = { now: NOW };

  const rotations = createRotations({
    candlesSince,
    sourceId: async (market) => (market === Market.TW ? "fake" : null),
    company: async ({ symbol }) =>
      symbol === "2330"
        ? { industry: { code: "24", name: "半導體業" }, shares: 1 }
        : null,
    answers: memoryAnswers(),
    now: () => clock.now,
  });

  return { rotations, candlesSince, clock };
}

test("sectors read the TAIEX's and each index's daily bars once and keep the answer a minute", async () => {
  const { rotations, candlesSince, clock } = setup();

  const sectors = await rotations.sectors();

  expect(candlesSince).toHaveBeenCalledTimes(TW_SECTOR_INDICES.length + 1);
  // Three years back, so a year of weeks can be read twice over.
  expect(candlesSince).toHaveBeenCalledWith(
    { market: Market.TW, symbol: "IX0001" },
    "2023-09-30"
  );
  expect(sectors?.find((each) => each.symbol === "IX0028")).toEqual({
    sector: TwSector.Semiconductors,
    group: SectorGroup.Electronics,
    symbol: "IX0028",
    readings: EMPTY_READINGS,
  });

  clock.now = new Date(NOW.getTime() + MINUTE_MS - 1);
  await rotations.sectors();

  expect(candlesSince).toHaveBeenCalledTimes(TW_SECTOR_INDICES.length + 1);
});

test("listings read each listing's daily bars and its market's index once", async () => {
  const { rotations, candlesSince } = setup();

  const symbols = [TSMC, { market: Market.TW, symbol: "2454" }];
  const listings = await rotations.listings(symbols);

  expect(candlesSince).toHaveBeenCalledTimes(3);
  expect(listings.map(({ symbol }) => symbol)).toEqual(symbols);
  expect(listings[0].readings).toEqual(EMPTY_READINGS);
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
    answers: memoryAnswers(),
  });

  expect(await rotations.sectors()).toBeNull();
});
