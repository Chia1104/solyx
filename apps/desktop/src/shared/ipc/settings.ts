import type { Market } from "@solyx/core/market";
import type { MarketDataPlan } from "@solyx/core/market-data";
import type { FuglePlan } from "@solyx/market-data/fugle";

/** Secrets the main process keeps encrypted by the OS; the renderer can save or delete one but never read it back. */
export const Secret = {
  FugleApiKey: "fugle-api-key",
  FubonPersonalId: "fubon-personal-id",
  FubonApiKey: "fubon-api-key",
  /** Optional: Fubon falls back to the ID number, the password of certificates exported from its website. */
  FubonCertPassword: "fubon-cert-password",
} as const;

export type Secret = (typeof Secret)[keyof typeof Secret];

export const SecretState = {
  Saved: "saved",
  Missing: "missing",
  /** Saved but no longer decryptable here, as after moving to another computer or user account. */
  Unreadable: "unreadable",
} as const;

export type SecretState = (typeof SecretState)[keyof typeof SecretState];

export interface SecretsStatus {
  /** False when the OS offers no secret store, so nothing can be saved. */
  available: boolean;
  states: Record<Secret, SecretState>;
}

/** Where a market's charts and live bars come from. */
export const MarketDataSource = {
  Fugle: "fugle",
  Fubon: "fubon",
} as const;

export type MarketDataSource =
  (typeof MarketDataSource)[keyof typeof MarketDataSource];

/** Files Fubon sign-in reads, saved as paths in the config file. */
export const FubonFile = {
  /** The folder extracted from Fubon's SDK download. */
  Sdk: "sdk",
  /** The certificate exported from Fubon's website. */
  Certificate: "certificate",
} as const;

export type FubonFile = (typeof FubonFile)[keyof typeof FubonFile];

/** A market's source and whether everything it connects with is saved. */
export interface MarketSource {
  source: MarketDataSource;
  ready: boolean;
}

/** The plans a provider sells, in its order, and the one the user holds. */
export interface PlanChoice<Plan extends string> {
  plan: Plan;
  plans: MarketDataPlan<Plan>[];
}

export interface MarketDataStatus {
  /** The config file that holds these settings, for editing by hand. */
  file: string;
  /** `null` where no source covers the market yet. */
  markets: Record<Market, MarketSource | null>;
  fugle: PlanChoice<FuglePlan>;
  fubon: { plan: MarketDataPlan; files: Record<FubonFile, string | null> };
}

export interface SettingsApi {
  secrets(): Promise<SecretsStatus>;
  saveSecret(secret: Secret, value: string): Promise<void>;
  deleteSecret(secret: Secret): Promise<void>;
  marketData(): Promise<MarketDataStatus>;
  /** Charts and the live stream switch to the source at once. */
  setMarketDataSource(
    market: typeof Market.TW,
    source: MarketDataSource
  ): Promise<void>;
  /** Saves the plan the Fugle key belongs to; request budgets and the live stream follow it at once. */
  setFuglePlan(plan: FuglePlan): Promise<void>;
  /** Asks for the file in a dialog and saves its path; resolves the path, or `null` when cancelled. */
  chooseFubonFile(file: FubonFile): Promise<string | null>;
  /** Signs in to Fubon again with the saved settings; resolves how many accounts it holds. */
  signInFubon(): Promise<number>;
}

export const settingsChannels = {
  secrets: "settings:secrets",
  saveSecret: "settings:save-secret",
  deleteSecret: "settings:delete-secret",
  marketData: "settings:market-data",
  setMarketDataSource: "settings:set-market-data-source",
  setFuglePlan: "settings:set-fugle-plan",
  chooseFubonFile: "settings:choose-fubon-file",
  signInFubon: "settings:sign-in-fubon",
} as const satisfies Record<keyof SettingsApi, string>;
