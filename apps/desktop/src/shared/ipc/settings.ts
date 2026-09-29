import type { Market } from "@solyx/core/market";

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

export interface SettingsApi {
  secrets(): Promise<SecretsStatus>;
  saveSecret(secret: Secret, value: string): Promise<void>;
  deleteSecret(secret: Secret): Promise<void>;
}

export const settingsChannels = {
  secrets: "settings:secrets",
  saveSecret: "settings:save-secret",
  deleteSecret: "settings:delete-secret",
} as const satisfies Record<keyof SettingsApi, string>;
