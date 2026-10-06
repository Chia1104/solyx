import { expect, test } from "vite-plus/test";

import { TW_SECTOR_INDICES, TwSector } from "../src/sectors.ts";

test("every sector has one index of its own", () => {
  const sectors = TW_SECTOR_INDICES.map((index) => index.sector);
  const symbols = TW_SECTOR_INDICES.map((index) => index.symbol);

  expect(new Set(sectors)).toEqual(new Set(Object.values(TwSector)));
  expect(new Set(symbols).size).toBe(symbols.length);
});
