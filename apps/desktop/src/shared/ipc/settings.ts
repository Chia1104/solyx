import * as z from "zod";

import type {
  McpServerState,
  McpToolPolicy,
  McpTransportKind,
} from "@solyx/agent/mcp-config";
import { AgentProvider } from "@solyx/agent/providers";
import type { AgentAuth, AgentThinking } from "@solyx/agent/providers";
import type { SkillSource } from "@solyx/agent/skill-source";
import type { Market } from "@solyx/core/market";
import type { MarketDataPlan } from "@solyx/core/market-data";
import type { FuglePlan } from "@solyx/market-data/fugle";

import type { ColorScheme, CustomPalette, PaletteToken } from "../palette.ts";

/** Secrets the main process keeps encrypted by the OS; the renderer can save or delete one but never read it back. */
export const Secret = {
  FugleApiKey: "fugle-api-key",
  FubonPersonalId: "fubon-personal-id",
  FubonApiKey: "fubon-api-key",
  /** Optional: Fubon falls back to the ID number, the password of certificates exported from its website. */
  FubonCertPassword: "fubon-cert-password",
  AnthropicApiKey: "anthropic-api-key",
  OpenAIApiKey: "openai-api-key",
  GoogleApiKey: "google-api-key",
  OpenRouterApiKey: "openrouter-api-key",
  /** The ChatGPT sign-in's OAuth tokens; the main process saves and refreshes them, nobody types them. */
  OpenAIChatGPT: "openai-chatgpt",
} as const;

export type Secret = (typeof Secret)[keyof typeof Secret];

/** The secrets a person types in, which the renderer may save or delete; a sign-in saves its own tokens. */
export const enteredSecretSchema = z.enum(Secret).exclude(["OpenAIChatGPT"]);

export type EnteredSecret = z.infer<typeof enteredSecretSchema>;

/** A secret an mcp.json entry names as `secret:NAME`, saved under `mcp:NAME`. */
export type McpSecretKey = `mcp:${string}`;

export function mcpSecretKey(name: string): McpSecretKey {
  return `mcp:${name}`;
}

/** A remote MCP server's sign-in, saved by the sign-in under the server's name in mcp.json. */
export type McpSignInKey = `mcp-oauth:${string}`;

export function mcpSignInKey(server: string): McpSignInKey {
  return `mcp-oauth:${server}`;
}

/** Every key the secret store saves under. */
export type SecretKey = Secret | McpSecretKey | McpSignInKey;

/** The key each agent provider runs on. */
export const AGENT_PROVIDER_SECRET: Record<AgentProvider, EnteredSecret> = {
  [AgentProvider.Anthropic]: Secret.AnthropicApiKey,
  [AgentProvider.OpenAI]: Secret.OpenAIApiKey,
  [AgentProvider.Google]: Secret.GoogleApiKey,
  [AgentProvider.OpenRouter]: Secret.OpenRouterApiKey,
};

/** The providers that can run on a subscription instead of a key, and the secret each sign-in is kept under. */
export const AGENT_SIGN_IN_SECRET: Partial<Record<AgentProvider, Secret>> = {
  [AgentProvider.OpenAI]: Secret.OpenAIChatGPT,
};

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

export const themeSchema = z.enum(Theme);

/** Which colour marks a rising price: each market's own convention, or the same one for every market. */
export const PriceColors = {
  /** Red in Taiwan, green in the US. */
  Market: "market",
  RedUp: "red-up",
  GreenUp: "green-up",
} as const;

export type PriceColors = (typeof PriceColors)[keyof typeof PriceColors];

export const priceColorsSchema = z.enum(PriceColors);

export interface Appearance {
  theme: Theme;
  /**
   * The palette each scheme shows, a built-in one or a key of `palettes`; the theme or the
   * computer decides which scheme that is.
   */
  palette: Record<ColorScheme, string>;
  /** The user's own palettes, by id. */
  palettes: Record<string, CustomPalette>;
  priceColors: PriceColors;
}

/** The languages the app has catalogs for, as BCP 47 tags. */
export const Locale = {
  EnUS: "en-US",
  ZhTW: "zh-TW",
} as const;

export type Locale = (typeof Locale)[keyof typeof Locale];

export const localeSchema = z.enum(Locale);

/** Where a market's charts and live bars come from. */
export const MarketDataSource = {
  Fugle: "fugle",
  Fubon: "fubon",
} as const;

export type MarketDataSource =
  (typeof MarketDataSource)[keyof typeof MarketDataSource];

export const marketDataSourceSchema = z.enum(MarketDataSource);

/** Files Fubon sign-in reads, saved as paths in the config file. */
export const FubonFile = {
  /** The folder extracted from Fubon's SDK download. */
  Sdk: "sdk",
  /** The certificate exported from Fubon's website. */
  Certificate: "certificate",
} as const;

export type FubonFile = (typeof FubonFile)[keyof typeof FubonFile];

export const fubonFileSchema = z.enum(FubonFile);

/** A market's source and whether everything it connects with is saved. */
export interface MarketSource {
  source: MarketDataSource;
  ready: boolean;
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
  /** The plans Fugle sells, in its order, and the one the user holds. */
  fugle: { plan: FuglePlan; plans: MarketDataPlan<FuglePlan>[] };
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

/** A model the agent can run on, from its provider's catalog. */
export interface AgentModelOption {
  id: string;
  name: string;
  /** Whether the thinking setting applies to it. */
  reasoning: boolean;
}

export interface AgentSettings {
  provider: AgentProvider;
  model: string;
  thinking: AgentThinking;
  /** Always `api-key` for a provider without a subscription sign-in. */
  auth: AgentAuth;
  /** `null` for a provider without a subscription sign-in. */
  subscription: { signedIn: boolean } | null;
  /** The provider's chat models, in its catalog's order. */
  models: AgentModelOption[];
  /** The key is saved or the subscription signed in, and the catalog has the model, so the agent can run. */
  ready: boolean;
}

/** A playbook the agent can read, as the settings page lists it. */
export interface AgentSkillInfo {
  name: string;
  description: string;
  source: SkillSource;
  /** Offered to the agent: the user's own and built-ins always, shared ones once switched on. */
  offered: boolean;
  /** Shared skills, which the user switches on one by one. */
  switchable: boolean;
}

export interface AgentSkills {
  skills: AgentSkillInfo[];
  /** Problems in the user's own skill files and in shared skills they switched on. */
  warnings: string[];
  /** The length of AGENTS.md beside the config file, sent with every message; `null` while there is none. */
  instructions: { characters: number } | null;
  /** Shown with the home folder as `~`. */
  paths: { skills: string; shared: string; instructions: string };
}

export interface McpToolSetting {
  name: string;
  title?: string;
  description?: string;
  /** Its server marks it read-only, so it may run without asking. */
  readOnly: boolean;
  policy: McpToolPolicy;
}

export interface McpServerSetting {
  name: string;
  kind: McpTransportKind;
  /** The command line or URL, so the user recognizes the entry. */
  target: string;
  state: McpServerState;
  error?: string;
  tools: McpToolSetting[];
  /** The secrets its entry names as `secret:NAME`, and whether each is saved. */
  secrets: { name: string; saved: boolean }[];
  /** A sign-in is saved for this remote server. */
  signedIn: boolean;
}

export interface McpSettings {
  /** Shown with the home folder as `~`. */
  path: string;
  /** Why mcp.json does not parse; the servers already running keep going. */
  error?: string;
  servers: McpServerSetting[];
}

/** Places on disk the app can show in the system file manager. */
export const AppLocation = {
  /** The app's `userData`: secrets, databases and caches. */
  Data: "data",
  /** The hand-editable config file. */
  Config: "config",
  /** `skills/` beside the config file, where the user's own skills live. */
  Skills: "skills",
  /** mcp.json beside the config file, which lists the MCP servers the agent may use. */
  Mcp: "mcp",
} as const;

export type AppLocation = (typeof AppLocation)[keyof typeof AppLocation];

export const appLocationSchema = z.enum(AppLocation);

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
  appearance(): Promise<Appearance>;
  /** Saves the theme; every window switches at once. */
  setTheme(theme: Theme): Promise<void>;
  setPalette(scheme: ColorScheme, palette: string): Promise<void>;
  /** Saves a custom palette that starts as a copy of `palette`, and resolves its id. */
  copyPalette(palette: string, name: string): Promise<string>;
  renamePalette(palette: string, name: string): Promise<void>;
  /** Sets one colour of a custom palette, or with `null` goes back to its base palette's. */
  setPaletteColor(
    palette: string,
    scheme: ColorScheme,
    token: PaletteToken,
    color: string | null
  ): Promise<void>;
  /** A scheme that showed it goes back to the palette it was copied from. */
  deletePalette(palette: string): Promise<void>;
  setPriceColors(priceColors: PriceColors): Promise<void>;
  secrets(): Promise<SecretsStatus>;
  saveSecret(secret: EnteredSecret, value: string): Promise<void>;
  deleteSecret(secret: EnteredSecret): Promise<void>;
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
  agent(): Promise<AgentSettings>;
  /** Switches the agent to the provider's default model as well. */
  setAgentProvider(provider: AgentProvider): Promise<void>;
  setAgentModel(model: string): Promise<void>;
  setAgentThinking(thinking: AgentThinking): Promise<void>;
  setAgentAuth(auth: AgentAuth): Promise<void>;
  /**
   * Signs in to the agent provider's subscription in the browser, resolving once the sign-in is
   * saved or cancelled. The page the browser lands on is written in `locale`.
   */
  signInSubscription(locale: Locale): Promise<void>;
  cancelSignIn(): Promise<void>;
  signOutSubscription(): Promise<void>;
  agentSkills(): Promise<AgentSkills>;
  /** Offers a skill from ~/.agents/skills to the agent, or stops offering it. */
  setSharedSkill(name: string, enabled: boolean): Promise<void>;
  /** Connects the servers in mcp.json on first use. */
  mcp(): Promise<McpSettings>;
  /** Lets the agent do the same with each of a server's `tools`, saved in one write. */
  setMcpToolPolicy(
    server: string,
    tools: string[],
    policy: McpToolPolicy
  ): Promise<void>;
  /** Saves a secret an entry names as `secret:NAME`; the server reconnects with it. */
  saveMcpSecret(server: string, name: string, value: string): Promise<void>;
  deleteMcpSecret(server: string, name: string): Promise<void>;
  reconnectMcp(server: string): Promise<void>;
  /**
   * Signs in to a remote server in the browser, resolving once the sign-in is saved and the server
   * reconnects, or once it is cancelled. The page the browser lands on is written in `locale`.
   */
  signInMcp(server: string, locale: Locale): Promise<void>;
  cancelMcpSignIn(): Promise<void>;
  signOutMcp(server: string): Promise<void>;
  cacheUsage(): Promise<CacheUsage>;
  /** Closed sessions are fetched again from the provider when charts need them. */
  clearCache(): Promise<void>;
  about(): Promise<AppInfo>;
  reveal(location: AppLocation): Promise<void>;
}

/** Pushes from the main process; each subscription returns a function that stops listening. */
export interface SettingsEvents {
  /** Every change to the appearance, whether saved here or by hand in the config file. */
  onAppearance(listener: (appearance: Appearance) => void): () => void;
}

export const settingsChannels = {
  appearance: "settings:appearance",
  setTheme: "settings:set-theme",
  setPalette: "settings:set-palette",
  copyPalette: "settings:copy-palette",
  renamePalette: "settings:rename-palette",
  setPaletteColor: "settings:set-palette-color",
  deletePalette: "settings:delete-palette",
  setPriceColors: "settings:set-price-colors",
  secrets: "settings:secrets",
  saveSecret: "settings:save-secret",
  deleteSecret: "settings:delete-secret",
  marketData: "settings:market-data",
  setMarketDataSource: "settings:set-market-data-source",
  setFuglePlan: "settings:set-fugle-plan",
  chooseFubonFile: "settings:choose-fubon-file",
  signInFubon: "settings:sign-in-fubon",
  agent: "settings:agent",
  setAgentProvider: "settings:set-agent-provider",
  setAgentModel: "settings:set-agent-model",
  setAgentThinking: "settings:set-agent-thinking",
  setAgentAuth: "settings:set-agent-auth",
  signInSubscription: "settings:sign-in-subscription",
  cancelSignIn: "settings:cancel-sign-in",
  signOutSubscription: "settings:sign-out-subscription",
  agentSkills: "settings:agent-skills",
  setSharedSkill: "settings:set-shared-skill",
  mcp: "settings:mcp",
  setMcpToolPolicy: "settings:set-mcp-tool-policy",
  saveMcpSecret: "settings:save-mcp-secret",
  deleteMcpSecret: "settings:delete-mcp-secret",
  reconnectMcp: "settings:reconnect-mcp",
  signInMcp: "settings:sign-in-mcp",
  cancelMcpSignIn: "settings:cancel-mcp-sign-in",
  signOutMcp: "settings:sign-out-mcp",
  cacheUsage: "settings:cache-usage",
  clearCache: "settings:clear-cache",
  about: "settings:about",
  reveal: "settings:reveal",
} as const satisfies Record<keyof SettingsApi, string>;

export const settingsEvents = {
  onAppearance: "settings:appearance-changed",
} as const satisfies Record<keyof SettingsEvents, string>;
