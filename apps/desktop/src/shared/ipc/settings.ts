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

/** The app's appearance; `system` follows the computer. Electron's `nativeTheme.themeSource` takes the same values. */
export const Theme = {
  System: "system",
  Light: "light",
  Dark: "dark",
} as const;

export type Theme = (typeof Theme)[keyof typeof Theme];

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

export const FubonSessionState = {
  /** Not signed in with the saved settings yet; the first Taiwan chart signs in. */
  SignedOut: "signed-out",
  SignedIn: "signed-in",
  /** Kept until the settings change or the user signs in again, since retries could lock the account. */
  Failed: "failed",
} as const;

export type FubonSessionState =
  (typeof FubonSessionState)[keyof typeof FubonSessionState];

export type FubonSessionStatus =
  | { state: typeof FubonSessionState.SignedOut }
  | { state: typeof FubonSessionState.SignedIn; accounts: number }
  | { state: typeof FubonSessionState.Failed; message: string };

export interface MarketDataStatus {
  /** `null` where no source covers the market yet. */
  markets: Record<Market, MarketSource | null>;
  fugle: PlanChoice<FuglePlan>;
  fubon: {
    plan: MarketDataPlan;
    files: Record<FubonFile, string | null>;
    session: FubonSessionStatus;
  };
}

/** What the candle cache holds for one provider, by its `id`. */
export interface CacheSourceUsage {
  source: string;
  series: number;
  bars: number;
}

export interface CacheUsage {
  /** On disk, with the write-ahead log. */
  bytes: number;
  sources: CacheSourceUsage[];
}

/** Places on disk the app can show in the system file manager. */
export const AppLocation = {
  /** The app's `userData`: secrets, databases and caches. */
  Data: "data",
  /** The hand-editable config file. */
  Config: "config",
} as const;

export type AppLocation = (typeof AppLocation)[keyof typeof AppLocation];

export interface AppInfo {
  /** The app's name, which also tells development builds apart. */
  name: string;
  version: string;
  packaged: boolean;
  electron: string;
  chromium: string;
  node: string;
  /** The OS as people name it, with its version and architecture. */
  os: string;
  /** Paths are shown with the home folder as `~`. */
  locations: Record<AppLocation, string>;
}

export interface SettingsApi {
  theme(): Promise<Theme>;
  /** Saves the theme; every window switches at once. */
  setTheme(theme: Theme): Promise<void>;
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
  /** Signs in to Fubon again with the saved settings; the market data status reports the outcome. */
  signInFubon(): Promise<void>;
  cacheUsage(): Promise<CacheUsage>;
  /** Closed sessions are fetched again from the provider when charts need them. */
  clearCache(): Promise<void>;
  about(): Promise<AppInfo>;
  reveal(location: AppLocation): Promise<void>;
}

export const settingsChannels = {
  theme: "settings:theme",
  setTheme: "settings:set-theme",
  secrets: "settings:secrets",
  saveSecret: "settings:save-secret",
  deleteSecret: "settings:delete-secret",
  marketData: "settings:market-data",
  setMarketDataSource: "settings:set-market-data-source",
  setFuglePlan: "settings:set-fugle-plan",
  chooseFubonFile: "settings:choose-fubon-file",
  signInFubon: "settings:sign-in-fubon",
  cacheUsage: "settings:cache-usage",
  clearCache: "settings:clear-cache",
  about: "settings:about",
  reveal: "settings:reveal",
} as const satisfies Record<keyof SettingsApi, string>;
