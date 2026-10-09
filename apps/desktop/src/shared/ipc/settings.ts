import * as z from "zod";

import type {
  McpServerState,
  McpToolPolicy,
  McpTransportKind,
} from "@solyx/agent/mcp-config";
import { hasSubscription } from "@solyx/agent/providers";
import type {
  AgentAuth,
  AgentProvider,
  AgentThinking,
} from "@solyx/agent/providers";
import type { AgentModelRef } from "@solyx/agent/providers";
import type { SkillSource } from "@solyx/agent/skill-source";
import type { DecisionMode, MagiUnit } from "@solyx/core/council";
import { Market } from "@solyx/core/market";
import type { MarketDataPlan } from "@solyx/core/market-data";
import type { DecisionsProvider } from "@solyx/decisions/provider";
import type { EmbeddingsProvider } from "@solyx/embeddings/provider";
import type {
  FinMindPlan,
  FinMindPlanLimits,
} from "@solyx/fundamentals/finmind";
import type { FuglePlan } from "@solyx/market-data/fugle";
import { isTimeZone } from "@solyx/utils/is";
import type { WebSearchProvider } from "@solyx/web-search/provider";

import type { ColorScheme, CustomPalette, PaletteToken } from "../palette.ts";

/** Secrets the main process keeps encrypted by the OS; the renderer can save or delete one but never read it back. */
export const Secret = {
  FugleApiKey: "fugle-api-key",
  FubonPersonalId: "fubon-personal-id",
  FubonApiKey: "fubon-api-key",
  /** Optional: Fubon falls back to the ID number, the password of certificates exported from its website. */
  FubonCertPassword: "fubon-cert-password",
  /** TypeSafe's key. */
  DecisionsApiKey: "decisions-api-key",
  /** A Cloudflare API token that may run Workers AI. */
  CloudflareApiKey: "cloudflare-api-key",
  /** An OpenAI API key for its Decisions API, kept apart from the agent's OpenAI sign-in or key. */
  OpenAIDecisionsApiKey: "openai-decisions-api-key",
  /** OpenAI's embeddings, kept apart from the agent's and the decisions model's OpenAI keys. */
  EmbeddingsApiKey: "embeddings-api-key",
  /** Optional: FinMind answers without one under a lower limit. */
  FinMindToken: "finmind-token",
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

/** The API key an agent provider runs on, saved under the provider's id. */
export type AgentKeySecret = `${AgentProvider}-api-key`;

export function agentKeySecret(provider: AgentProvider): AgentKeySecret {
  return `${provider}-api-key`;
}

/**
 * The API key a web search vendor runs on, saved under the vendor's id, so a vendor that also
 * serves models keeps one key for both.
 */
export type WebSearchKeySecret = `${WebSearchProvider}-api-key`;

export function webSearchKeySecret(
  provider: WebSearchProvider
): WebSearchKeySecret {
  return `${provider}-api-key`;
}

/** Every key the secret store saves under. */
export type SecretKey =
  | Secret
  | AgentKeySecret
  | WebSearchKeySecret
  | McpSecretKey
  | McpSignInKey;

/** The secret a provider's subscription sign-in is kept under; `undefined` for a provider without one. */
export function agentSignInSecret(provider: AgentProvider): Secret | undefined {
  return hasSubscription(provider) ? Secret.OpenAIChatGPT : undefined;
}

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

/** A time zone as an IANA name, such as `Asia/Taipei`, which the user's own clock follows. */
export const timeZoneSchema = z
  .string()
  .refine(isTimeZone, { error: "Not a time zone this computer knows" });

export type TimeZone = z.infer<typeof timeZoneSchema>;

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

/** Whether Taiwan market data has everything its source connects with saved. */
export function isMarketDataReady(status: MarketDataStatus | undefined) {
  return status?.markets[Market.TW]?.ready === true;
}

/** A model the agent can run on, from its provider's catalog. */
export interface AgentModelOption {
  provider: AgentProvider;
  id: string;
  name: string;
  /** Whether the thinking setting applies to it. */
  reasoning: boolean;
  /** Tokens a request may hold, prompt and answer together. */
  contextWindow: number;
}

/** One provider as the settings page lists it. */
export interface AgentProviderSettings {
  provider: AgentProvider;
  /** pi-ai's name for it, a brand name the page shows as it is. */
  name: string;
  /** Its models are offered to conversations; the default model's provider always is. */
  enabled: boolean;
  /** On the settings page: switched on, or something is saved for it, so a saved key can be found. */
  listed: boolean;
  /** Always `api-key` for a provider without a subscription sign-in. */
  auth: AgentAuth;
  /** `null` for a provider without a subscription sign-in. */
  subscription: { signedIn: boolean } | null;
  /** The API key saved for it, whatever it runs on now. */
  key: SecretState;
  /** Its key is saved or its subscription signed in, so its models can run. */
  usable: boolean;
  /**
   * Where its requests go on an API key, and its own endpoint, which `url` reads as until one is
   * set. `null` for a provider whose models use several endpoints, so none can stand in for them.
   */
  endpoint: { url: string; default: string } | null;
}

export interface AgentSettings {
  /** Every provider the user can switch on, by name. */
  providers: AgentProviderSettings[];
  /** The model new conversations start on, and one keeps until the user picks its own. */
  provider: AgentProvider;
  model: string;
  thinking: AgentThinking;
  /** Who decides the agent's forecasts and order proposals. */
  decisionMode: DecisionMode;
  /** The model each MAGI unit answers on; `null` follows the conversation's. */
  magi: Record<MagiUnit, AgentModelRef | null>;
  /** The chat models of every provider switched on, each provider's in its catalog's order. */
  models: AgentModelOption[];
  /**
   * A provider switched on can run, so the agent can run on one of its models; the default model
   * may still be one that cannot.
   */
  ready: boolean;
}

/** Hours between automatic news collections for each watched listing; 0 turns it off. */
export const newsIntervalSchema = z
  .number()
  .int()
  .min(0)
  .max(24 * 30);

/** Every three days, so a web search vendor's free tier covers a watchlist of about ten listings. */
export const NEWS_COLLECTION_DEFAULT_HOURS = 72;

/** The intervals the settings page offers, in hours; the config file takes any. */
export const NEWS_COLLECTION_PRESETS: readonly number[] = [
  0, 6, 12, 24, 72, 168,
];

export interface NewsSettings {
  collectEveryHours: number;
}

export interface FundamentalsSettings {
  /** The plans FinMind sells, in its order, and the one the user's token belongs to. */
  finMind: { plan: FinMindPlan; plans: FinMindPlanLimits[] };
}

export interface MemorySettings {
  /** The agent reads its memories and may ask to save, rewrite or forget one. */
  enabled: boolean;
}

export interface UpdateSettings {
  /** The app checks for a newer version on its own while it runs. */
  check: boolean;
}

/** The web search vendor news and the agent search and read through, and each vendor's key. */
export interface WebSearchSettings {
  provider: WebSearchProvider;
  keys: Record<WebSearchProvider, SecretState>;
}

/** Whether the vendor in use has its key saved, so news and the agent can search the web. */
export function isWebSearchReady(settings: WebSearchSettings | undefined) {
  return (
    settings !== undefined &&
    settings.keys[settings.provider] === SecretState.Saved
  );
}

/** The secret each decisions provider's key is kept under. */
export const DECISIONS_SECRETS = {
  typesafe: Secret.DecisionsApiKey,
  cloudflare: Secret.CloudflareApiKey,
  openai: Secret.OpenAIDecisionsApiKey,
} as const satisfies Record<DecisionsProvider, Secret>;

/** One decisions provider's own settings; its key is the secret `DECISIONS_SECRETS` names. */
export interface DecisionsProviderSettings {
  provider: DecisionsProvider;
  model: string;
  baseURL: string;
  /** What each reads as while the config file does not set it. */
  defaults: { model: string; baseURL: string };
  /** Cloudflare's alone: the account whose Workers AI runs the model, `null` until it is set. */
  accountId?: string | null;
}

/** The decisions providers as set up, and the one whose model scores texts. */
export interface DecisionsSettings {
  provider: DecisionsProvider;
  providers: DecisionsProviderSettings[];
}

/** Whether the provider in use has its key saved, and Cloudflare its account, so its model can score. */
export function isDecisionsReady(
  settings: DecisionsSettings | undefined,
  secrets: SecretsStatus | undefined
) {
  const current = settings?.providers.find(
    (each) => each.provider === settings.provider
  );

  return (
    current !== undefined &&
    current.accountId !== null &&
    secrets?.states[DECISIONS_SECRETS[current.provider]] === SecretState.Saved
  );
}

/** Experimental: news grouping that also joins items whose vectors read alike. */
export interface EmbeddingsSettings {
  enabled: boolean;
  provider: EmbeddingsProvider;
  /** The model and vector length the provider's settings pick. */
  space: string;
  /** A line was measured on `space`, without which its vectors join nothing. */
  measured: boolean;
}

/** A playbook the agent can read, as the settings page lists it. */
export interface AgentSkillInfo {
  name: string;
  description: string;
  source: SkillSource;
  /** Offered to the agent: the user's own and built-ins always, shared ones once switched on. */
  offered: boolean;
  /** The user may ask for it by starting a message with `/name`. */
  userInvocable: boolean;
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
  /** The agent may run shell commands on this computer, each once the user allows it. */
  shell: boolean;
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
  /** Lets conversations pick the provider's models, or stops offering them. */
  setAgentProviderEnabled(
    provider: AgentProvider,
    enabled: boolean
  ): Promise<void>;
  /** Makes the provider's default model the one new conversations start on. */
  setAgentProvider(provider: AgentProvider): Promise<void>;
  setAgentModel(model: string): Promise<void>;
  setAgentThinking(thinking: AgentThinking): Promise<void>;
  setAgentDecisionMode(mode: DecisionMode): Promise<void>;
  /** `null` has the unit answer on the conversation's model. */
  setMagiModel(unit: MagiUnit, model: AgentModelRef | null): Promise<void>;
  setAgentAuth(auth: AgentAuth): Promise<void>;
  saveAgentKey(provider: AgentProvider, value: string): Promise<void>;
  deleteAgentKey(provider: AgentProvider): Promise<void>;
  /** Sends the provider's requests on an API key to `endpoint`; `null` goes back to its own. */
  setAgentEndpoint(
    provider: AgentProvider,
    endpoint: string | null
  ): Promise<void>;
  /**
   * Signs in to the provider's subscription in the browser, resolving once the sign-in is saved
   * or cancelled. The page the browser lands on is written in `locale`.
   */
  signInSubscription(provider: AgentProvider, locale: Locale): Promise<void>;
  cancelSignIn(): Promise<void>;
  signOutSubscription(provider: AgentProvider): Promise<void>;
  news(): Promise<NewsSettings>;
  fundamentals(): Promise<FundamentalsSettings>;
  /** Saves the plan the FinMind token belongs to; its limit and the datasets read follow it at once. */
  setFinMindPlan(plan: FinMindPlan): Promise<void>;
  setNewsCollectEveryHours(hours: number): Promise<void>;
  webSearch(): Promise<WebSearchSettings>;
  /** Picks the vendor news and the agent search through. */
  setWebSearchProvider(provider: WebSearchProvider): Promise<void>;
  saveWebSearchKey(provider: WebSearchProvider, value: string): Promise<void>;
  deleteWebSearchKey(provider: WebSearchProvider): Promise<void>;
  decisions(): Promise<DecisionsSettings>;
  /** Picks the provider whose model scores texts. */
  setDecisionsProvider(provider: DecisionsProvider): Promise<void>;
  /** `null` goes back to the default. */
  setDecisionsModel(
    provider: DecisionsProvider,
    model: string | null
  ): Promise<void>;
  /** `null` goes back to the default. */
  setDecisionsBaseURL(
    provider: DecisionsProvider,
    baseURL: string | null
  ): Promise<void>;
  /** Cloudflare's account; `null` removes it. */
  setDecisionsAccountId(accountId: string | null): Promise<void>;
  embeddings(): Promise<EmbeddingsSettings>;
  setEmbeddingsEnabled(enabled: boolean): Promise<void>;
  /** Picks where vectors come from; vectors of the other provider's model are dropped as new ones are kept. */
  setEmbeddingsProvider(provider: EmbeddingsProvider): Promise<void>;
  agentSkills(): Promise<AgentSkills>;
  /** Offers a skill from ~/.agents/skills to the agent, or stops offering it. */
  setSharedSkill(name: string, enabled: boolean): Promise<void>;
  /** Gives the agent the shell from its next run on, or takes it away. */
  setAgentShell(enabled: boolean): Promise<void>;
  memory(): Promise<MemorySettings>;
  /** Gives the agent its memories from its next run on, or takes them away; they stay saved. */
  setMemoryEnabled(enabled: boolean): Promise<void>;
  updates(): Promise<UpdateSettings>;
  setUpdateChecks(enabled: boolean): Promise<void>;
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
  about(): Promise<AppInfo>;
  reveal(location: AppLocation): Promise<void>;
}

/** Pushes from the main process; each subscription returns a function that stops listening. */
export interface SettingsEvents {
  /** Every change to the appearance, whether saved here or by hand in the config file. */
  onAppearance(listener: (appearance: Appearance) => void): () => void;
  /** Some setting or saved secret changed, here or by hand in the config file. */
  onChanged(listener: () => void): () => void;
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
  setAgentProviderEnabled: "settings:set-agent-provider-enabled",
  setAgentProvider: "settings:set-agent-provider",
  setAgentModel: "settings:set-agent-model",
  setAgentThinking: "settings:set-agent-thinking",
  setAgentDecisionMode: "settings:set-agent-decision-mode",
  setMagiModel: "settings:set-magi-model",
  setAgentAuth: "settings:set-agent-auth",
  saveAgentKey: "settings:save-agent-key",
  deleteAgentKey: "settings:delete-agent-key",
  setAgentEndpoint: "settings:set-agent-endpoint",
  signInSubscription: "settings:sign-in-subscription",
  cancelSignIn: "settings:cancel-sign-in",
  signOutSubscription: "settings:sign-out-subscription",
  news: "settings:news",
  setNewsCollectEveryHours: "settings:set-news-collect-every-hours",
  fundamentals: "settings:fundamentals",
  setFinMindPlan: "settings:set-finmind-plan",
  webSearch: "settings:web-search",
  setWebSearchProvider: "settings:set-web-search-provider",
  saveWebSearchKey: "settings:save-web-search-key",
  deleteWebSearchKey: "settings:delete-web-search-key",
  decisions: "settings:decisions",
  setDecisionsProvider: "settings:set-decisions-provider",
  setDecisionsModel: "settings:set-decisions-model",
  setDecisionsBaseURL: "settings:set-decisions-base-url",
  setDecisionsAccountId: "settings:set-decisions-account-id",
  embeddings: "settings:embeddings",
  setEmbeddingsEnabled: "settings:set-embeddings-enabled",
  setEmbeddingsProvider: "settings:set-embeddings-provider",
  agentSkills: "settings:agent-skills",
  setSharedSkill: "settings:set-shared-skill",
  setAgentShell: "settings:set-agent-shell",
  memory: "settings:memory",
  setMemoryEnabled: "settings:set-memory-enabled",
  updates: "settings:updates",
  setUpdateChecks: "settings:set-update-checks",
  mcp: "settings:mcp",
  setMcpToolPolicy: "settings:set-mcp-tool-policy",
  saveMcpSecret: "settings:save-mcp-secret",
  deleteMcpSecret: "settings:delete-mcp-secret",
  reconnectMcp: "settings:reconnect-mcp",
  signInMcp: "settings:sign-in-mcp",
  cancelMcpSignIn: "settings:cancel-mcp-sign-in",
  signOutMcp: "settings:sign-out-mcp",
  about: "settings:about",
  reveal: "settings:reveal",
} as const satisfies Record<keyof SettingsApi, string>;

export const settingsEvents = {
  onAppearance: "settings:appearance-changed",
  onChanged: "settings:changed",
} as const satisfies Record<keyof SettingsEvents, string>;
