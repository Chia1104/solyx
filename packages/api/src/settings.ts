import * as z from "zod";

import type {
  McpServerState,
  McpToolPolicy,
  McpTransportKind,
} from "@solyx/agent/mcp-config";
import type {
  AgentAuth,
  AgentProvider,
  AgentThinking,
} from "@solyx/agent/providers";
import type { AgentModelRef } from "@solyx/agent/providers";
import type { SkillSource } from "@solyx/agent/skill-source";
import type { DecisionMode, MagiUnit } from "@solyx/core/council";
import { mandateSchema } from "@solyx/core/mandate";
import { Market } from "@solyx/core/market";
import type { Currency } from "@solyx/core/market";
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

import type { ColorScheme, CustomPalette } from "./palette.ts";

/** An http(s) endpoint, which a proxy on this computer may serve without TLS. */
export const endpointSchema = z.url({ protocol: /^https?$/ }).max(2048);

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
  /** Optional: for the user's own Ollama behind a proxy that checks a bearer token. */
  OllamaEmbeddingsApiKey: "ollama-embeddings-api-key",
  /** Optional: FinMind answers without one under a lower limit. */
  FinMindToken: "finmind-token",
  /** Optional: what traces and logs are sent with, such as an authorization, as OTEL_EXPORTER_OTLP_HEADERS writes them. */
  OtlpHeaders: "otlp-headers",
  /** The id of the access key that may read and write the bucket backups go to. */
  BackupAccessKeyId: "backup-access-key-id",
  BackupSecretAccessKey: "backup-secret-access-key",
  /** What every backup is sealed under; a backup cannot be opened without it. */
  BackupPassphrase: "backup-passphrase",
} as const;

export type Secret = (typeof Secret)[keyof typeof Secret];

/** The secrets a person types in, which the renderer may save or delete; a sign-in saves its own tokens. */
export const enteredSecretSchema = z.enum(Secret);

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
 * A provider's subscription sign-in, its OAuth tokens saved under the provider's id; the main
 * process saves and refreshes them, nobody types them.
 */
export type AgentSignInSecret = `${AgentProvider}-sign-in`;

export function agentSignInSecret(provider: AgentProvider): AgentSignInSecret {
  return `${provider}-sign-in`;
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

/**
 * The user's trading mandate, sealed with the secrets so no edit of the app's files can forge
 * one; the renderer reads it back through its own procedures, never as a secret.
 */
export const MANDATE_SECRET = "trading-mandate";

/** Every key the secret store saves under. */
export type SecretKey =
  | Secret
  | AgentKeySecret
  | AgentSignInSecret
  | WebSearchKeySecret
  | McpSecretKey
  | McpSignInKey
  | typeof MANDATE_SECRET;

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
  language: LanguagePreference;
  timeZone: TimeZonePreference;
}

/** The languages the app has catalogs for, as BCP 47 tags. */
export const Locale = {
  EnUS: "en-US",
  ZhTW: "zh-TW",
} as const;

export type Locale = (typeof Locale)[keyof typeof Locale];

export const localeSchema = z.enum(Locale);

/** The language the user picked: a catalog, or `system` to follow the computer's language. */
export const LanguagePreference = { System: "system", ...Locale } as const;

export type LanguagePreference =
  (typeof LanguagePreference)[keyof typeof LanguagePreference];

export const languagePreferenceSchema = z.enum(LanguagePreference);

/** The catalog `preference` shows on a computer whose own language is `system`, a BCP 47 tag. */
export function resolveLocale(
  preference: LanguagePreference,
  system: string
): Locale {
  if (preference !== LanguagePreference.System) return preference;

  // zh-TW is the only Chinese catalog, so every Chinese system locale lands on it; any other
  // language has no catalog and gets English.
  return system.toLowerCase().startsWith("zh") ? Locale.ZhTW : Locale.EnUS;
}

/** A time zone as an IANA name, such as `Asia/Taipei`, which the user's own clock follows. */
export const timeZoneSchema = z
  .string()
  .refine(isTimeZone, { error: "Not a time zone this computer knows" });

export type TimeZone = z.infer<typeof timeZoneSchema>;

/** The time zone the user picked: an IANA name, or `system` to follow the computer's clock. */
export const TimeZonePreference = { System: "system" } as const;

export type TimeZonePreference =
  | (typeof TimeZonePreference)[keyof typeof TimeZonePreference]
  | TimeZone;

export const timeZonePreferenceSchema = z.union([
  z.literal(TimeZonePreference.System),
  timeZoneSchema,
]);

/** The zone `preference` shows on a computer whose own clock keeps `system`. */
export function resolveTimeZone(
  preference: TimeZonePreference,
  system: TimeZone
): TimeZone {
  return preference === TimeZonePreference.System ? system : preference;
}

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
  /** Not signed in with the saved settings yet; the first Taiwan chart from Fubon, or the desk trading through it, signs in. */
  SignedOut: "signed-out",
  SignedIn: "signed-in",
  /** Kept until the settings change or the user signs in again, since retries could lock the account. */
  Failed: "failed",
} as const;

export type FubonSessionState =
  (typeof FubonSessionState)[keyof typeof FubonSessionState];

export type FubonSessionStatus =
  | { state: typeof FubonSessionState.SignedOut }
  | {
      state: typeof FubonSessionState.SignedIn;
      accounts: number;
      /** The stock accounts orders may go to, each by its `<branch>-<account>` with its holder's name as Fubon masks it. */
      stockAccounts: { id: string; name: string }[];
    }
  | { state: typeof FubonSessionState.Failed; message: string };

export interface MarketDataStatus {
  /** `null` where no source covers the market yet. */
  markets: Record<Market, MarketSource | null>;
  /** The plans Fugle sells, in its order, and the one the user holds. */
  fugle: { plan: FuglePlan; plans: MarketDataPlan<FuglePlan>[] };
  fubon: {
    plan: MarketDataPlan;
    /** Whether everything Fubon signs in with is saved, whichever source Taiwan's charts come from. */
    ready: boolean;
    files: Record<FubonFile, string | null>;
    /** The version of the SDK in the folder chosen, `null` where none is chosen or there is no SDK in it. */
    sdkVersion: string | null;
    /** The SDK's versions Solyx was checked with in Fubon's test environment. */
    testedSdkVersions: string[];
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
  /** Always `api-key` for a provider without a subscription sign-in, and `subscription` for one that takes no key. */
  auth: AgentAuth;
  /**
   * The plan a sign-in runs it on, a brand name the page shows as it is, whether that sign-in is
   * saved, and whether it runs on nothing else, so it takes no key; `null` for a provider without
   * a subscription sign-in.
   */
  subscription: { plan: string; signedIn: boolean; only: boolean } | null;
  /** The API key saved for it, whatever it runs on now. */
  key: SecretState;
  /** A sign-in to it in the browser creates that key, in place of one pasted in. */
  createsKey: boolean;
  /** Its key is saved or its subscription signed in, so its models can run. */
  usable: boolean;
  /**
   * Where its requests go on an API key, and its own endpoint, which `url` reads as until one is
   * set. `null` for a provider whose models use several endpoints, so none can stand in for them.
   */
  endpoint: { url: string; default: string } | null;
  /**
   * A server the user runs, which takes no key unless a proxy in front of it checks one and lists
   * the models it holds, with why it failed to when last asked; `null` for every other provider.
   */
  server: { failure: string | null } | null;
}

/** What a server the user runs lists of the models that can run the agent. */
export interface AgentServerModels {
  /** How many of the models it holds can run the agent. */
  models: number;
  /** Why it failed to list them when last asked; `null` once it answered. */
  failure: string | null;
}

/** The code a sign-in waits for the user to enter on the provider's page. */
export interface SignInCode {
  provider: AgentProvider;
  code: string;
  /** The provider's page, which the main process opened in the browser. */
  url: string;
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

export interface FundamentalsSettings {
  /** The plans FinMind sells, in its order, and the one the user's token belongs to. */
  finMind: { plan: FinMindPlan; plans: FinMindPlanLimits[] };
}

export interface MemorySettings {
  /** The agent reads its memories and may ask to save, rewrite or forget one. */
  enabled: boolean;
}

export interface TraySettings {
  /** The app keeps an icon in the tray and stays open there once its last window closes. */
  show: boolean;
  /** The app leaves the Dock while no window is open, which applies only while the icon shows. */
  hideDock: boolean;
  /** This computer has a Dock to leave, as only macOS does. */
  hasDock: boolean;
}

/** The account the order desk trades. */
export const TradingBroker = {
  Paper: "paper",
  Fubon: "fubon",
} as const;

export type TradingBroker = (typeof TradingBroker)[keyof typeof TradingBroker];

export const tradingBrokerSchema = z.enum(TradingBroker);

/** Where the user has orders go: the paper account, or one of Fubon's stock accounts by its `<branch>-<account>`. */
export const tradingAccountSchema = z.discriminatedUnion("broker", [
  z.object({ broker: z.literal(TradingBroker.Paper), account: z.null() }),
  z.object({
    broker: z.literal(TradingBroker.Fubon),
    account: z.string().min(1),
  }),
]);

export type TradingAccount = z.infer<typeof tradingAccountSchema>;

/** The most days a mandate lasts before the user sets it again. */
export const MAX_MANDATE_DAYS = 30;

/** A mandate as the user sets it: the app binds it to the account the desk trades and dates it. */
export const mandateDraftSchema = mandateSchema
  .omit({ broker: true, expiresAt: true })
  .extend({ days: z.number().int().min(1).max(MAX_MANDATE_DAYS) });

export type MandateDraft = z.infer<typeof mandateDraftSchema>;

export interface TradingSettings {
  /** The broker the user picked, which the desk trades from the app's next start on. */
  broker: TradingBroker;
  /** The broker's account the user picked; `null` for the paper account, and for Fubon until one is picked. */
  account: string | null;
  /** The broker and account the desk trades now, picked when the app started, as their `brokerId`. */
  trading: string;
  /** Every order is refused until the user unlocks them. */
  locked: boolean;
  /** The most the account's sales may lose in a market's day, per currency; a currency missing has no limit. */
  maxDailyLoss: Partial<Record<Currency, number>>;
}

export interface UpdateSettings {
  /** The app checks for a newer version on its own while it runs. */
  check: boolean;
}

export interface OtlpSettings {
  /** Where traces and logs go over OTLP/HTTP; `null` sends none. */
  endpoint: string | null;
}

export interface CrashReportSettings {
  /** The user agreed to send Solyx's maintainer a report of each crash and unexpected error. */
  send: boolean;
  /** This build has somewhere to send them; development builds and forks do not. */
  available: boolean;
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
  /** Where Ollama listens: this computer's unless the user set a host of their own. */
  ollamaBaseURL: string;
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
