import { orderBy, sumBy } from "es-toolkit";
import * as z from "zod";

import type { Company, Listed } from "./fundamentals.ts";
import { quoteSchema } from "./market-data.ts";
import type { Quote } from "./market-data.ts";
import { Market } from "./market.ts";

/**
 * The buckets a market's sectors are reported in: Taiwan's as its exchange reports its sector
 * indices, the US's as the economy moves them, the cyclical ones with it, the sensitive ones a
 * step behind it and the defensive ones least.
 */
export const SectorGroup = {
  Electronics: "electronics",
  Finance: "finance",
  Other: "other",
  Cyclical: "cyclical",
  Sensitive: "sensitive",
  Defensive: "defensive",
} as const;

export type SectorGroup = (typeof SectorGroup)[keyof typeof SectorGroup];

/** Each market's groups, in the order its sectors are shown. */
export const SECTOR_GROUPS: Record<Market, readonly SectorGroup[]> = {
  [Market.TW]: [
    SectorGroup.Electronics,
    SectorGroup.Finance,
    SectorGroup.Other,
  ],
  [Market.US]: [
    SectorGroup.Cyclical,
    SectorGroup.Sensitive,
    SectorGroup.Defensive,
  ],
};

/** Industries of the Taiwan Stock Exchange's current classification that have a price index. */
export const TwSector = {
  Cement: "cement",
  Food: "food",
  Plastics: "plastics",
  Textiles: "textiles",
  ElectricMachinery: "electric-machinery",
  ElectricalCable: "electrical-cable",
  Chemicals: "chemicals",
  Biotech: "biotech",
  Glass: "glass",
  Paper: "paper",
  Steel: "steel",
  Rubber: "rubber",
  Automobiles: "automobiles",
  Semiconductors: "semiconductors",
  Computers: "computers",
  Optoelectronics: "optoelectronics",
  Communications: "communications",
  Components: "components",
  Distribution: "distribution",
  InformationServices: "information-services",
  OtherElectronics: "other-electronics",
  Construction: "construction",
  Shipping: "shipping",
  Tourism: "tourism",
  Finance: "finance",
  OilGas: "oil-gas",
  Other: "other",
  GreenEnergy: "green-energy",
  DigitalCloud: "digital-cloud",
  Sports: "sports",
  HomeLiving: "home-living",
} as const;

export type TwSector = (typeof TwSector)[keyof typeof TwSector];

/** The S&P 500's sectors, the eleven of the Global Industry Classification Standard. */
export const UsSector = {
  Technology: "technology",
  Financials: "financials",
  HealthCare: "health-care",
  ConsumerDiscretionary: "consumer-discretionary",
  ConsumerStaples: "consumer-staples",
  CommunicationServices: "communication-services",
  Industrials: "industrials",
  Energy: "energy",
  Materials: "materials",
  Utilities: "utilities",
  RealEstate: "real-estate",
} as const;

export type UsSector = (typeof UsSector)[keyof typeof UsSector];

/** A sector of any market. */
export const Sector = { ...TwSector, ...UsSector } as const;

export type Sector = (typeof Sector)[keyof typeof Sector];

/** What a sector's moves are read from: its exchange's index, or a listed fund that holds the sector. */
export interface SectorIndex<S extends Sector = Sector> {
  sector: S;
  group: SectorGroup;
  /** The index's or fund's symbol, as the exchange codes it. */
  symbol: string;
}

const sector = <S extends Sector>(
  group: SectorGroup,
  entries: [S, string][]
): SectorIndex<S>[] =>
  entries.map(([each, symbol]) => ({ sector: each, group, symbol }));

/**
 * Each listed industry's own index. Indices that add industries up, such as the electronics or
 * chemical and biotech ones, are left out, so no listing counts twice.
 */
export const TW_SECTOR_INDICES: readonly SectorIndex<TwSector>[] = [
  ...sector(SectorGroup.Electronics, [
    [TwSector.Semiconductors, "IX0028"],
    [TwSector.Computers, "IX0029"],
    [TwSector.Optoelectronics, "IX0030"],
    [TwSector.Communications, "IX0031"],
    [TwSector.Components, "IX0032"],
    [TwSector.Distribution, "IX0033"],
    [TwSector.InformationServices, "IX0034"],
    [TwSector.OtherElectronics, "IX0035"],
  ]),
  ...sector(SectorGroup.Finance, [[TwSector.Finance, "IX0039"]]),
  ...sector(SectorGroup.Other, [
    [TwSector.Cement, "IX0010"],
    [TwSector.Food, "IX0011"],
    [TwSector.Plastics, "IX0012"],
    [TwSector.Textiles, "IX0016"],
    [TwSector.ElectricMachinery, "IX0017"],
    [TwSector.ElectricalCable, "IX0018"],
    [TwSector.Chemicals, "IX0020"],
    [TwSector.Biotech, "IX0021"],
    [TwSector.Glass, "IX0022"],
    [TwSector.Paper, "IX0023"],
    [TwSector.Steel, "IX0024"],
    [TwSector.Rubber, "IX0025"],
    [TwSector.Automobiles, "IX0026"],
    [TwSector.Construction, "IX0036"],
    [TwSector.Shipping, "IX0037"],
    [TwSector.Tourism, "IX0038"],
    [TwSector.OilGas, "IX0041"],
    [TwSector.Other, "IX0042"],
    [TwSector.GreenEnergy, "IX0185"],
    [TwSector.DigitalCloud, "IX0186"],
    [TwSector.Sports, "IX0187"],
    [TwSector.HomeLiving, "IX0188"],
  ]),
];

/**
 * The S&P 500's sectors as State Street's Select Sector funds hold them, since the US has no
 * index of its sectors a source quotes. A fund's value traded is the fund's own, not its sector's.
 */
export const US_SECTOR_FUNDS: readonly SectorIndex<UsSector>[] = [
  ...sector(SectorGroup.Cyclical, [
    [UsSector.ConsumerDiscretionary, "XLY"],
    [UsSector.Financials, "XLF"],
    [UsSector.Materials, "XLB"],
    [UsSector.RealEstate, "XLRE"],
  ]),
  ...sector(SectorGroup.Sensitive, [
    [UsSector.Technology, "XLK"],
    [UsSector.CommunicationServices, "XLC"],
    [UsSector.Industrials, "XLI"],
    [UsSector.Energy, "XLE"],
  ]),
  ...sector(SectorGroup.Defensive, [
    [UsSector.HealthCare, "XLV"],
    [UsSector.ConsumerStaples, "XLP"],
    [UsSector.Utilities, "XLU"],
  ]),
];

/** What each market's sectors are read from. */
export const SECTOR_INDICES: Record<Market, readonly SectorIndex[]> = {
  [Market.TW]: TW_SECTOR_INDICES,
  [Market.US]: US_SECTOR_FUNDS,
};

/** A sector index or fund and its session so far. */
export const sectorQuoteSchema = z.object({
  sector: z.enum(Sector),
  group: z.enum(SectorGroup),
  symbol: z.string(),
  /** `null` until the index has traded. */
  quote: quoteSchema.nullable(),
});

export type SectorQuote = z.infer<typeof sectorQuoteSchema>;

/** How a sector's index moved in its session, and the sector's part of the trading. */
export interface SectorMove extends SectorIndex {
  quote: Quote;
  /** Points the index moved from its reference. */
  change: number;
  /** That move as a fraction of the reference. */
  percent: number;
  /** Its part of the value every sector traded so far, from 0 to 1; 0 while none has. */
  share: number;
}

/** The sectors that have traded, in the order given. */
export function sectorMoves(sectors: readonly SectorQuote[]): SectorMove[] {
  const total = sumBy(sectors, ({ quote }) => quote?.tradeValue ?? 0);

  return sectors.flatMap(({ quote, ...index }) => {
    if (!quote) return [];

    const change = quote.last - quote.reference;

    return [
      {
        ...index,
        quote,
        change,
        percent: change / quote.reference,
        share: total > 0 ? quote.tradeValue / total : 0,
      },
    ];
  });
}

/** The exchange's own code for the industry each sector index is drawn from. */
export const TW_SECTOR_INDUSTRY: Record<TwSector, string> = {
  [TwSector.Cement]: "01",
  [TwSector.Food]: "02",
  [TwSector.Plastics]: "03",
  [TwSector.Textiles]: "04",
  [TwSector.ElectricMachinery]: "05",
  [TwSector.ElectricalCable]: "06",
  [TwSector.Glass]: "08",
  [TwSector.Paper]: "09",
  [TwSector.Steel]: "10",
  [TwSector.Rubber]: "11",
  [TwSector.Automobiles]: "12",
  [TwSector.Construction]: "14",
  [TwSector.Shipping]: "15",
  [TwSector.Tourism]: "16",
  [TwSector.Finance]: "17",
  [TwSector.Other]: "20",
  [TwSector.Chemicals]: "21",
  [TwSector.Biotech]: "22",
  [TwSector.OilGas]: "23",
  [TwSector.Semiconductors]: "24",
  [TwSector.Computers]: "25",
  [TwSector.Optoelectronics]: "26",
  [TwSector.Communications]: "27",
  [TwSector.Components]: "28",
  [TwSector.Distribution]: "29",
  [TwSector.InformationServices]: "30",
  [TwSector.OtherElectronics]: "31",
  [TwSector.GreenEnergy]: "35",
  [TwSector.DigitalCloud]: "36",
  [TwSector.Sports]: "37",
  [TwSector.HomeLiving]: "38",
};

/** The sector whose index is drawn from the exchange's industry `code`; `null` for an industry with none, as depositary receipts. */
export function sectorOfIndustry(code: string): TwSector | null {
  const found = Object.values(TwSector).find(
    (sector) => TW_SECTOR_INDUSTRY[sector] === code
  );

  return found ?? null;
}

/** A listing's close of a session as its exchange lists it, with its change from the close before. */
export interface SessionClose {
  /** The session's exchange-local day. */
  date: string;
  close: number;
  change: number;
}

/** A listing's part of its sector's move over a session, by what its market value gained. */
export interface SectorMover {
  symbol: string;
  /** Its move as a fraction of the close before. */
  percent: number;
  /** What its shares gained in all, a loss below zero, in the market's currency. */
  valueChange: number;
}

/** A sector's companies over the exchange's last session: those that moved its market value most, and the rest in all. */
export interface SectorMovers {
  sector: TwSector;
  /** The session's exchange-local day. */
  date: string;
  /** What its companies' shares were worth at the close before. */
  marketValue: number;
  valueChange: number;
  /** Largest move of value first, either way. */
  movers: SectorMover[];
  rest: { companies: number; valueChange: number };
}

/** How many of a sector's companies are named before the rest are summed. */
export const SECTOR_MOVERS = 10;

/**
 * Which of a sector's companies moved its market value most over the session the closes are of,
 * by each one's shares times its change. A sector index weighs its listings by market value, so
 * these are the companies that moved it. Only a company with both a count of shares and a close
 * of that session counts; `null` where none has.
 */
export function sectorMovers(
  sector: TwSector,
  companies: readonly Listed<Company>[],
  closes: readonly Listed<SessionClose>[],
  top = SECTOR_MOVERS
): SectorMovers | null {
  const closed = new Map(closes.map((each) => [each.symbol, each]));
  const industry = TW_SECTOR_INDUSTRY[sector];

  const members = companies.flatMap(
    ({ symbol, industry: { code }, shares }) => {
      const session = closed.get(symbol);

      if (code !== industry || shares === null || !session) return [];

      const before = session.close - session.change;

      return [
        {
          symbol,
          date: session.date,
          before: shares * before,
          percent: before > 0 ? session.change / before : 0,
          valueChange: shares * session.change,
        },
      ];
    }
  );

  if (members.length === 0) return null;

  const ranked = orderBy(
    members,
    [({ valueChange }) => Math.abs(valueChange)],
    ["desc"]
  );

  const rest = ranked.slice(top);

  return {
    sector,
    // ISO dates sort as text, and the newest is the session the list is of.
    date:
      members
        .map(({ date }) => date)
        .toSorted()
        .at(-1) ?? "",
    marketValue: sumBy(members, (member) => member.before),
    valueChange: sumBy(members, (member) => member.valueChange),
    movers: ranked.slice(0, top).map(({ symbol, percent, valueChange }) => ({
      symbol,
      percent,
      valueChange,
    })),
    rest: {
      companies: rest.length,
      valueChange: sumBy(rest, (member) => member.valueChange),
    },
  };
}
