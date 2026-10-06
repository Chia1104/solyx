/** The buckets the Taiwan Stock Exchange reports its sector indices in. */
export const SectorGroup = {
  Electronics: "electronics",
  Finance: "finance",
  Other: "other",
} as const;

export type SectorGroup = (typeof SectorGroup)[keyof typeof SectorGroup];

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

export interface SectorIndex {
  sector: TwSector;
  group: SectorGroup;
  /** The index's symbol, as the exchange codes it. */
  symbol: string;
}

const sector = (
  group: SectorGroup,
  entries: [TwSector, string][]
): SectorIndex[] =>
  entries.map(([each, symbol]) => ({ sector: each, group, symbol }));

/**
 * Each listed industry's own index. Indices that add industries up, such as the electronics or
 * chemical and biotech ones, are left out, so no listing counts twice.
 */
export const TW_SECTOR_INDICES: readonly SectorIndex[] = [
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
