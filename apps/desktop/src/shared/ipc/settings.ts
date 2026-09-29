import type { Market } from "@solyx/core/market";
import type { MarketDataPlan } from "@solyx/core/market-data";
import type { FuglePlan } from "@solyx/market-data/fugle";

/** Secrets the main process keeps encrypted by the OS; the renderer can save or delete one but never read it back. */
export const Secret = {
  FugleApiKey: "fugle-api-key",
} as const;

export type Secret = (typeof Secret)[keyof typeof Secret];

export const SecretState = {
  Saved: "saved",
  Missing: "missing",
  /** Saved but no longer decryptable here, as after moving to another computer or user account. */
  Unreadable: "unreadable",
} as const;

export type SecretState = (typeof SecretState)[keyof typeof SecretState];

/** The key each market's data provider needs, or `null` where no provider exists yet. */
export const MARKET_DATA_SECRET = {
  TW: Secret.FugleApiKey,
  US: null,
} as const satisfies Record<Market, Secret | null>;

export interface SecretsStatus {
  /** False when the OS offers no secret store, so nothing can be saved. */
  available: boolean;
  states: Record<Secret, SecretState>;
}

/** The plans a provider sells, in its order, and the one the user holds. */
export interface PlanChoice<Plan extends string> {
  plan: Plan;
  plans: MarketDataPlan<Plan>[];
}

/** Each market data provider's plans, by the provider's `id`. */
export interface ProviderPlans {
  fugle: PlanChoice<FuglePlan>;
}

export interface ProviderPlansStatus {
  /** The config file that also holds the plans, for editing by hand. */
  file: string;
  providers: ProviderPlans;
}

export interface SettingsApi {
  secrets(): Promise<SecretsStatus>;
  saveSecret(secret: Secret, value: string): Promise<void>;
  deleteSecret(secret: Secret): Promise<void>;
  providerPlans(): Promise<ProviderPlansStatus>;
  /** Saves the plan the user holds; request budgets and the live stream follow it at once. */
  setProviderPlan(provider: keyof ProviderPlans, plan: string): Promise<void>;
}

export const settingsChannels = {
  secrets: "settings:secrets",
  saveSecret: "settings:save-secret",
  deleteSecret: "settings:delete-secret",
  providerPlans: "settings:provider-plans",
  setProviderPlan: "settings:set-provider-plan",
} as const satisfies Record<keyof SettingsApi, string>;
