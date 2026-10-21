import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { contentText } from "@earendil-works/pi-ai";
import type {
  ToolExecutionApi,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import { expect, test, vi } from "vite-plus/test";

import { Interval } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { MarketData } from "@solyx/core/market-data";
import { Quadrant, RotationInterval } from "@solyx/core/rotation";
import type {
  ListingRotation,
  RotationSet,
  SectorRotation,
} from "@solyx/core/rotation";
import { TW_SECTOR_INDICES, TwSector } from "@solyx/core/sectors";
import type { SectorMovers, SectorQuote } from "@solyx/core/sectors";

import { createSectorTools } from "../src/sectors.ts";
import { AgentToolName } from "../src/wire.ts";

// 2026-10-13 10:42 in Taipei.
const NOW = new Date("2026-10-13T02:42:00Z");

const taipei = (date: string) => Date.parse(`${date}T00:00:00+08:00`) / 1000;

const bar = (date: string, close: number): Candle => ({
  time: taipei(date),
  open: close,
  high: close,
  low: close,
  close,
  volume: 0,
});

const TAIEX = [bar("2026-10-12", 23_000), bar("2026-10-13", 23_230)];

const QUOTES: Partial<Record<TwSector, [number, number, number]>> = {
  [TwSector.Semiconductors]: [1212, 1200, 6e11],
  [TwSector.Finance]: [2475, 2500, 1e11],
  [TwSector.Shipping]: [190, 200, 5e10],
  [TwSector.ElectricMachinery]: [515, 500, 2.5e11],
  [TwSector.Tourism]: [121.3, 121.3, 0],
};

/** Every sector index, with a session only for the ones `QUOTES` names. */
const sectorsOf = (quotes: typeof QUOTES): SectorQuote[] =>
  TW_SECTOR_INDICES.map((index) => {
    const quote = quotes[index.sector];

    return {
      ...index,
      quote: quote
        ? {
            date: "2026-10-13",
            last: quote[0],
            reference: quote[1],
            tradeValue: quote[2],
          }
        : null,
    };
  });

function setup(
  sectors: SectorQuote[] | null,
  movers: SectorMovers | null = null,
  rotations: SectorRotation[] | null = null
) {
  const marketData = {
    candles: vi.fn<MarketData["candles"]>(async () => TAIEX),
  };

  const listingRotations = vi.fn(
    async (
      symbols: readonly SymbolRef[],
      _through?: string
    ): Promise<RotationSet<ListingRotation>> => ({
      asOf: "2026-10-13",
      sessions: ["2026-10-13"],
      entries: symbols.map((symbol) => ({ symbol, readings: [] })),
    })
  );

  const rotationsRead = vi.fn(
    async (_through?: string): Promise<RotationSet<SectorRotation> | null> =>
      rotations && {
        asOf: "2026-10-13",
        sessions: ["2026-10-13"],
        entries: rotations,
      }
  );

  const [tool, moversTool, rotationTool] =
    createSectorTools({
      sectors: async () => sectors,
      movers: async () => movers,
      rotations: rotationsRead,
      listingRotations,
      marketData,
      now: () => NOW,
    }).tools ?? [];

  const execute = async (
    registered: ToolRegistration,
    params: Parameters<ToolRegistration["execute"]>[0]
  ) => {
    // SAFETY: neither sector tool uses its call's api.
    const api = {} as ToolExecutionApi;
    const result = await registered.execute(params, api, BACKGROUND_CONTEXT);

    return { text: contentText(result.output ?? []), details: result.details };
  };

  const run = (params: Parameters<ToolRegistration["execute"]>[0]) =>
    execute(tool, params);

  const runMovers = (params: Parameters<ToolRegistration["execute"]>[0]) =>
    execute(moversTool, params);

  const runRotation = (params: Parameters<ToolRegistration["execute"]>[0]) =>
    execute(rotationTool, params);

  return {
    tool,
    moversTool,
    rotationTool,
    run,
    runMovers,
    runRotation,
    marketData,
    listingRotations,
    rotationsRead,
  };
}

test("lists the market's index and each traded sector, largest rise first, as the app computed them", async () => {
  const sectors = sectorsOf(QUOTES);
  const { tool, run, marketData } = setup(sectors);

  expect(tool.name).toBe(AgentToolName.GetSectors);

  const { text, details } = await run({});

  expect(marketData.candles).toHaveBeenCalledWith(
    { market: Market.TW, symbol: "IX0001" },
    Interval.OneDay
  );

  const lines = text.split("\n");

  expect(lines.slice(0, 9)).toEqual([
    "Taiwan's listed sectors as_of 2026-10-13 10:42 Taipei, session 2026-10-13; value in TWD millions, share of what all the sectors traded",
    "TAIEX (TW IX0001) on 2026-10-13: 23230, +1.00% on the session before",
    "2 sectors up, 2 down, 1 unchanged",
    "Share of the trading by group: electronics 60.0%, finance 10.0%, other 30.0%",
    "sector,group,index,last,change,percent,value,share",
    "electric machinery,other,IX0017,515,+15.00,+3.00%,250000,25.0%",
    "semiconductors,electronics,IX0028,1212,+12.00,+1.00%,600000,60.0%",
    "tourism,other,IX0038,121.3,0.00,0.00%,0,0.0%",
    "finance,finance,IX0039,2475,-25.00,-1.00%,100000,10.0%",
  ]);
  expect(lines[9]).toBe("shipping,other,IX0037,190,-10.00,-5.00%,50000,5.0%");
  expect(lines[10]).toMatch(/^Not traded yet: .*glass \(IX0022\)/);
  expect(lines).toHaveLength(11);
  expect(details).toEqual({ sectors });
});

test("says so before any sector has traded", async () => {
  const sectors = sectorsOf({});
  const { run } = setup(sectors);

  const { text, details } = await run({});

  expect(text.split("\n")).toEqual([
    "Taiwan's listed sectors as_of 2026-10-13 10:42 Taipei: no sector index has traded yet in this session.",
    "TAIEX (TW IX0001) on 2026-10-13: 23230, +1.00% on the session before",
  ]);
  expect(details).toEqual({ sectors });
});

test("says no source covers Taiwan rather than fail", async () => {
  const { run, marketData } = setup(null);

  const { text, details } = await run({});

  expect(text).toBe(
    "No sector indices: no market data source covers Taiwan yet. get_setup says what is missing."
  );
  expect(details).toBeUndefined();
  expect(marketData.candles).not.toHaveBeenCalled();
});

test("names the companies that moved a sector's market value most over the exchange's last session, and sums the rest", async () => {
  const { moversTool, runMovers } = setup(null, {
    sector: TwSector.Semiconductors,
    date: "2026-10-16",
    marketValue: 100_000_000_000_000,
    valueChange: -800_000_000_000,
    movers: [
      { symbol: "2330", percent: -0.0082, valueChange: -518_000_000_000 },
      { symbol: "2454", percent: -0.021, valueChange: -120_000_000_000 },
    ],
    rest: { companies: 150, valueChange: -162_000_000_000 },
  });

  expect(moversTool.name).toBe(AgentToolName.GetSectorMovers);

  const { text } = await runMovers({ sector: TwSector.Semiconductors });

  expect(text.split("\n")).toEqual([
    "semiconductors over the Taiwan Stock Exchange's session of 2026-10-16: its companies' shares were worth 100000000 million TWD at the close before and moved -800000 million (-0.80%). By what each one's shares gained, in TWD millions, and that in points of the sector's market value, which add up to its move:",
    "symbol,percent,value change,contribution",
    "2330,-0.82%,-518000,-0.52%",
    "2454,-2.10%,-120000,-0.12%",
    "the other 150,,-162000,-0.16%",
  ]);
});

test("says when no session lists a company of the sector", async () => {
  const { runMovers } = setup(null);

  const { text } = await runMovers({ sector: TwSector.Cement });

  expect(text).toBe(
    "No session the exchange has published lists a company of cement."
  );
});

const index = (sector: TwSector) =>
  TW_SECTOR_INDICES.find((each) => each.sector === sector)!;

/** A reading over 60 sessions whose trail runs from `first` to `last`. */
const reading = (
  first: [number, number],
  last: [number, number],
  transition: SectorRotation["readings"][number]["transition"] = null
) => ({
  interval: RotationInterval.Daily,
  period: 60,
  trail: [
    { date: "2026-09-29", level: first[0], momentum: first[1] },
    { date: "2026-10-13", level: last[0], momentum: last[1] },
  ],
  quadrant:
    last[0] >= 0
      ? last[1] >= 0
        ? Quadrant.Leading
        : Quadrant.Weakening
      : last[1] >= 0
        ? Quadrant.Improving
        : Quadrant.Lagging,
  transition,
});

test("places every sector by quadrant from the host's readings, the highest level first in each", async () => {
  const rotations: SectorRotation[] = [
    {
      ...index(TwSector.Finance),
      readings: [reading([-0.5, -0.2], [-1.2, 0.3])],
    },
    {
      ...index(TwSector.Semiconductors),
      readings: [
        reading([-0.3, 0.8], [1.2, 0.4], {
          from: Quadrant.Improving,
          to: Quadrant.Leading,
          date: "2026-10-06",
        }),
      ],
    },
    {
      ...index(TwSector.Shipping),
      readings: [reading([0.1, 0.2], [1.8, 0.1])],
    },
    {
      ...index(TwSector.Glass),
      readings: [
        {
          interval: RotationInterval.Daily,
          period: 60,
          trail: [],
          quadrant: null,
          transition: null,
        },
      ],
    },
  ];

  const { rotationTool, runRotation } = setup(null, null, rotations);

  expect(rotationTool.name).toBe(AgentToolName.GetRotation);

  const { text } = await runRotation({});
  const lines = text.split("\n");

  expect(lines[0]).toMatch(
    /^Taiwan's listed sectors' rotation against the TAIEX over 60 sessions to 2026-10-13 as_of 2026-10-13 10:42 Taipei: the level is how far/
  );
  expect(lines.slice(1)).toEqual([
    "name,quadrant,level,momentum,crossed,trail start (level/momentum)",
    "shipping (IX0037),leading,+1.80,+0.10,none in the trail,+0.10/+0.20 on 2026-09-29",
    "semiconductors (IX0028),leading,+1.20,+0.40,2026-10-06 from improving,-0.30/+0.80 on 2026-09-29",
    "finance (IX0039),improving,-1.20,+0.30,none in the trail,-0.50/-0.20 on 2026-09-29",
    "Too few bars: glass (IX0022)",
  ]);
});

test("refuses a period the app does not read", async () => {
  const { runRotation } = setup(null, null, []);

  await expect(runRotation({ period: 30 })).rejects.toThrow(
    "One of 20, 60, 120"
  );
});

test("places listings the model names through the host's reading of them against their market's index", async () => {
  const { runRotation, listingRotations } = setup(null);

  const symbols = [
    { market: Market.TW, symbol: "2330" },
    { market: Market.US, symbol: "NVDA" },
    { market: Market.TW, symbol: "2454" },
  ];

  listingRotations.mockResolvedValueOnce({
    asOf: "2026-10-13",
    sessions: ["2026-10-13"],
    entries: [
      {
        symbol: symbols[0],
        readings: [reading([0.2, 0.1], [0.9, -0.4])],
      },
      { symbol: symbols[1], readings: [reading([-1, -1], [-0.2, 0.6])] },
      {
        symbol: symbols[2],
        readings: [
          {
            interval: RotationInterval.Daily,
            period: 60,
            trail: [],
            quadrant: null,
            transition: null,
          },
        ],
      },
    ],
  });

  const { text } = await runRotation({ symbols });

  expect(listingRotations).toHaveBeenCalledWith(symbols, undefined);

  const lines = text.split("\n");

  expect(lines[0]).toMatch(
    /^Rotation of 3 listings against their market's index over 60 sessions as_of 2026-10-13 10:42 Taipei: the level is how far the listing's price over TAIEX or S&P 500 \(SPY\)'s stands/
  );
  expect(lines.slice(1)).toEqual([
    "name,quadrant,level,momentum,crossed,trail start (level/momentum)",
    "TW 2330,weakening,+0.90,-0.40,none in the trail,+0.20/+0.10 on 2026-09-29",
    "US NVDA,improving,-0.20,+0.60,none in the trail,-1.00/-1.00 on 2026-09-29",
    "Too few bars: TW 2454",
  ]);
});

test("says no source covers Taiwan rather than fail the rotation", async () => {
  const { runRotation } = setup(null);

  const { text } = await runRotation({});

  expect(text).toBe(
    "No sector indices: no market data source covers Taiwan yet. get_setup says what is missing."
  );
});

test("reads the graph as it stood at the close of a session the model names", async () => {
  const { runRotation, rotationsRead } = setup(null, null, []);

  const { text } = await runRotation({ through: "2026-09-30" });

  expect(rotationsRead).toHaveBeenCalledWith("2026-09-30");
  expect(text).toMatch(
    /as_of 2026-10-13 10:42 Taipei, read as it stood at the close of 2026-09-30:/
  );
});
