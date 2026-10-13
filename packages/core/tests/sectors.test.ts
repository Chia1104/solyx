import { expect, test } from "vite-plus/test";

import {
  SectorGroup,
  TW_SECTOR_INDICES,
  TwSector,
  sectorMoves,
} from "../src/sectors.ts";

test("every sector has one index of its own", () => {
  const sectors = TW_SECTOR_INDICES.map((index) => index.sector);
  const symbols = TW_SECTOR_INDICES.map((index) => index.symbol);

  expect(new Set(sectors)).toEqual(new Set(Object.values(TwSector)));
  expect(new Set(symbols).size).toBe(symbols.length);
});

const index = (sector: TwSector) => {
  const found = TW_SECTOR_INDICES.find((each) => each.sector === sector);

  if (!found) throw new Error(`No index for ${sector}`);

  return found;
};

const quote = (last: number, reference: number, tradeValue: number) => ({
  date: "2026-09-29",
  last,
  reference,
  tradeValue,
});

test("a sector's move is measured from its reference and its share from what all sectors traded", () => {
  const moves = sectorMoves([
    { ...index(TwSector.Semiconductors), quote: quote(1212, 1200, 9e10) },
    { ...index(TwSector.Glass), quote: null },
    { ...index(TwSector.Finance), quote: quote(2475, 2500, 3e10) },
  ]);

  expect(moves).toEqual([
    {
      sector: TwSector.Semiconductors,
      group: SectorGroup.Electronics,
      symbol: "IX0028",
      quote: quote(1212, 1200, 9e10),
      change: 12,
      percent: 0.01,
      share: 0.75,
    },
    {
      sector: TwSector.Finance,
      group: SectorGroup.Finance,
      symbol: "IX0039",
      quote: quote(2475, 2500, 3e10),
      change: -25,
      percent: -0.01,
      share: 0.25,
    },
  ]);
});

test("no sector has a share before any has traded", () => {
  const [move] = sectorMoves([
    { ...index(TwSector.Cement), quote: quote(150, 150, 0) },
  ]);

  expect(move).toMatchObject({ change: 0, percent: 0, share: 0 });
});
