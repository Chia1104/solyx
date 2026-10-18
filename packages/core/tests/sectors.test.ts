import { expect, test } from "vite-plus/test";

import {
  SectorGroup,
  TW_SECTOR_INDICES,
  TwSector,
  sectorMoves,
  TW_SECTOR_INDUSTRY,
  sectorMovers,
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

test("each sector index is drawn from one industry of the exchange's own codes", () => {
  expect(new Set(Object.values(TW_SECTOR_INDUSTRY)).size).toBe(
    TW_SECTOR_INDICES.length
  );
});

test("a sector's movers are its companies by what their shares gained, the top named and the rest summed", () => {
  const chips = { code: "24", name: "半導體業" };

  const companies = [
    { symbol: "2330", industry: chips, shares: 100 },
    { symbol: "2303", industry: chips, shares: 1_000 },
    { symbol: "2454", industry: chips, shares: 50 },
    // No count of shares, or no close of the session, as a TPEx company has none of TWSE's.
    { symbol: "3711", industry: chips, shares: null },
    { symbol: "5483", industry: chips, shares: 500 },
    {
      symbol: "1101",
      industry: { code: "01", name: "水泥工業" },
      shares: 9_000,
    },
  ];

  const closes = [
    { symbol: "2330", date: "2026-10-16", close: 1010, change: 10 },
    { symbol: "2303", date: "2026-10-16", close: 49, change: -1 },
    { symbol: "2454", date: "2026-10-16", close: 1205, change: 5 },
    { symbol: "3711", date: "2026-10-16", close: 150, change: 3 },
    { symbol: "1101", date: "2026-10-16", close: 30, change: 1 },
  ];

  expect(sectorMovers(TwSector.Semiconductors, companies, closes, 2)).toEqual({
    sector: TwSector.Semiconductors,
    date: "2026-10-16",
    marketValue: 100 * 1000 + 1_000 * 50 + 50 * 1200,
    valueChange: 1_000 - 1_000 + 250,
    movers: [
      { symbol: "2330", percent: 0.01, valueChange: 1_000 },
      { symbol: "2303", percent: -0.02, valueChange: -1_000 },
    ],
    rest: { companies: 1, valueChange: 250 },
  });
  expect(sectorMovers(TwSector.Steel, companies, closes)).toBeNull();
});
