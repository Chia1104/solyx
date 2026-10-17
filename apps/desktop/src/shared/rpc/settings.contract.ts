import { asyncIteratorObject, oc, type } from "@orpc/contract";
import * as z from "zod";

import {
  mcpSecretNameSchema,
  mcpToolPolicySchema,
} from "@solyx/agent/mcp-config";
import {
  agentAuthSchema,
  agentModelRefSchema,
  agentProviderSchema,
  agentThinkingSchema,
} from "@solyx/agent/providers";
import { MagiUnit, decisionModeSchema } from "@solyx/core/council";
import { Market } from "@solyx/core/market";
import { NewsVoice } from "@solyx/core/news";
import { decisionsProviderSchema } from "@solyx/decisions/provider";
import { embeddingsProviderSchema } from "@solyx/embeddings/provider";
import { finMindPlanSchema } from "@solyx/fundamentals/finmind";
import { fuglePlanSchema } from "@solyx/market-data/fugle";
import { webSearchProviderSchema } from "@solyx/web-search/provider";

import { newsRetentionSchema } from "../news.ts";
import type { NewsRetentionSettings } from "../news.ts";
import {
  colorSchemeSchema,
  hexColorSchema,
  paletteTokenSchema,
} from "../palette.ts";
import {
  appLocationSchema,
  endpointSchema,
  enteredSecretSchema,
  fubonFileSchema,
  languagePreferenceSchema,
  localeSchema,
  marketDataSourceSchema,
  priceColorsSchema,
  themeSchema,
  timeZonePreferenceSchema,
} from "../settings.ts";
import type {
  AgentSettings,
  AgentSkills,
  AppInfo,
  Appearance,
  CrashReportSettings,
  DecisionsSettings,
  EmbeddingsSettings,
  FundamentalsSettings,
  MarketDataStatus,
  McpSettings,
  MemorySettings,
  OtlpSettings,
  SecretsStatus,
  SignInCode,
  TraySettings,
  UpdateSettings,
  WebSearchSettings,
} from "../settings.ts";

import { changesContract } from "./changes.ts";

/** A key or token as the user pastes it. */
const keySchema = z.string().trim().min(1).max(1024);

/** A model's id, as its provider names it. */
const modelSchema = z.string().trim().min(1).max(200);

// An MCP server's or tool's name, as mcp.json and the server give it.
const mcpNameSchema = z.string().min(1).max(128);

// A palette's id, which a person may have written into the config file.
const paletteIdSchema = z.string().min(1).max(128);

const paletteNameSchema = z.string().trim().min(1).max(60);

export const settingsContract = {
  appearance: oc.output(type<Appearance>()),
  /** Saves the theme; every window switches at once. */
  setTheme: oc.input(themeSchema).output(type<void>()),
  setPalette: oc
    .input(z.object({ scheme: colorSchemeSchema, palette: paletteIdSchema }))
    .output(type<void>()),
  /** Saves a custom palette that starts as a copy of `palette`, and resolves its id. */
  copyPalette: oc
    .input(z.object({ palette: paletteIdSchema, name: paletteNameSchema }))
    .output(type<string>()),
  renamePalette: oc
    .input(z.object({ palette: paletteIdSchema, name: paletteNameSchema }))
    .output(type<void>()),
  /** Sets one colour of a custom palette, or with `null` goes back to its base palette's. */
  setPaletteColor: oc
    .input(
      z.object({
        palette: paletteIdSchema,
        scheme: colorSchemeSchema,
        token: paletteTokenSchema,
        color: hexColorSchema.nullable(),
      })
    )
    .output(type<void>()),
  /** A scheme that showed it goes back to the palette it was copied from. */
  deletePalette: oc.input(paletteIdSchema).output(type<void>()),
  setPriceColors: oc.input(priceColorsSchema).output(type<void>()),
  /** Saves the language; every window and the tray's menu switch at once. */
  setLanguage: oc.input(languagePreferenceSchema).output(type<void>()),
  /** Saves the clock the app's own times show on; every window and the tray's menu follow at once. */
  setTimeZone: oc.input(timeZonePreferenceSchema).output(type<void>()),
  secrets: oc.output(type<SecretsStatus>()),
  saveSecret: oc
    .input(z.object({ secret: enteredSecretSchema, value: keySchema }))
    .output(type<void>()),
  deleteSecret: oc.input(enteredSecretSchema).output(type<void>()),
  marketData: oc.output(type<MarketDataStatus>()),
  /** Charts and the live stream switch to the source at once. */
  setMarketDataSource: oc
    .input(
      z.object({
        market: z.literal(Market.TW),
        source: marketDataSourceSchema,
      })
    )
    .output(type<void>()),
  /** Saves the plan the Fugle key belongs to; request budgets and the live stream follow it at once. */
  setFuglePlan: oc.input(fuglePlanSchema).output(type<void>()),
  /** Asks for the file in a dialog over the asking window and saves its path; resolves the path, or `null` when cancelled. */
  chooseFubonFile: oc.input(fubonFileSchema).output(type<string | null>()),
  /** Signs in to Fubon again with the saved settings; the market data status reports the outcome. */
  signInFubon: oc.output(type<void>()),
  agent: oc.output(type<AgentSettings>()),
  /** Lets conversations pick the provider's models, or stops offering them. */
  setAgentProviderEnabled: oc
    .input(z.object({ provider: agentProviderSchema, enabled: z.boolean() }))
    .output(type<void>()),
  /** Makes the provider's default model the one new conversations start on. */
  setAgentProvider: oc.input(agentProviderSchema).output(type<void>()),
  setAgentModel: oc.input(modelSchema).output(type<void>()),
  setAgentThinking: oc.input(agentThinkingSchema).output(type<void>()),
  setAgentDecisionMode: oc.input(decisionModeSchema).output(type<void>()),
  /** `null` has the unit answer on the conversation's model. */
  setMagiModel: oc
    .input(
      z.object({
        unit: z.enum(MagiUnit),
        model: agentModelRefSchema.nullable(),
      })
    )
    .output(type<void>()),
  /** Runs the provider on its key or on its subscription's sign-in. */
  setAgentAuth: oc
    .input(z.object({ provider: agentProviderSchema, auth: agentAuthSchema }))
    .output(type<void>()),
  saveAgentKey: oc
    .input(z.object({ provider: agentProviderSchema, value: keySchema }))
    .output(type<void>()),
  deleteAgentKey: oc.input(agentProviderSchema).output(type<void>()),
  /**
   * Signs in to the provider in the browser, where the user has it create a key for the app, and
   * saves that key as the provider's, resolving once it is saved or the sign-in cancelled. The
   * page the browser lands on is written in `locale`.
   */
  createAgentKey: oc
    .input(z.object({ provider: agentProviderSchema, locale: localeSchema }))
    .output(type<void>()),
  /** Sends the provider's requests on an API key to `endpoint`; `null` goes back to its own. */
  setAgentEndpoint: oc
    .input(
      z.object({
        provider: agentProviderSchema,
        endpoint: endpointSchema.nullable(),
      })
    )
    .output(type<void>()),
  /**
   * Signs in to the provider's subscription in the browser, resolving once the sign-in is saved
   * or cancelled. A sign-in that runs on a code yields it through `signInCodes`; the page the
   * browser lands on where one returns to this computer is written in `locale`.
   */
  signInSubscription: oc
    .input(z.object({ provider: agentProviderSchema, locale: localeSchema }))
    .output(type<void>()),
  cancelSignIn: oc.output(type<void>()),
  signOutSubscription: oc.input(agentProviderSchema).output(type<void>()),
  fundamentals: oc.output(type<FundamentalsSettings>()),
  /** Saves the plan the FinMind token belongs to; its limit and the datasets read follow it at once. */
  setFinMindPlan: oc.input(finMindPlanSchema).output(type<void>()),
  webSearch: oc.output(type<WebSearchSettings>()),
  /** Picks the vendor news and the agent search through. */
  setWebSearchProvider: oc.input(webSearchProviderSchema).output(type<void>()),
  saveWebSearchKey: oc
    .input(z.object({ provider: webSearchProviderSchema, value: keySchema }))
    .output(type<void>()),
  deleteWebSearchKey: oc.input(webSearchProviderSchema).output(type<void>()),
  decisions: oc.output(type<DecisionsSettings>()),
  /** Picks the provider whose model scores texts. */
  setDecisionsProvider: oc.input(decisionsProviderSchema).output(type<void>()),
  /** `null` goes back to the default. */
  setDecisionsModel: oc
    .input(
      z.object({
        provider: decisionsProviderSchema,
        model: modelSchema.nullable(),
      })
    )
    .output(type<void>()),
  /** `null` goes back to the default. */
  setDecisionsBaseURL: oc
    .input(
      z.object({
        provider: decisionsProviderSchema,
        baseURL: endpointSchema.nullable(),
      })
    )
    .output(type<void>()),
  /** Cloudflare's account; `null` removes it. */
  setDecisionsAccountId: oc
    .input(z.string().trim().min(1).max(200).nullable())
    .output(type<void>()),
  embeddings: oc.output(type<EmbeddingsSettings>()),
  setEmbeddingsEnabled: oc.input(z.boolean()).output(type<void>()),
  /** Picks where vectors come from; vectors of the other provider's model are dropped as new ones are kept. */
  setEmbeddingsProvider: oc
    .input(embeddingsProviderSchema)
    .output(type<void>()),
  /** Points Ollama's embeddings at a host of the user's own; `null` goes back to this computer's. */
  setOllamaBaseURL: oc.input(endpointSchema.nullable()).output(type<void>()),
  agentSkills: oc.output(type<AgentSkills>()),
  /** Offers a skill from ~/.agents/skills to the agent, or stops offering it. */
  setSharedSkill: oc
    .input(z.object({ name: z.string().min(1).max(64), enabled: z.boolean() }))
    .output(type<void>()),
  /** Gives the agent the shell from its next run on, or takes it away. */
  setAgentShell: oc.input(z.boolean()).output(type<void>()),
  memory: oc.output(type<MemorySettings>()),
  /** Gives the agent its memories from its next run on, or takes them away; they stay saved. */
  setMemoryEnabled: oc.input(z.boolean()).output(type<void>()),
  tray: oc.output(type<TraySettings>()),
  /** Puts the icon in the tray or takes it away, at once. */
  setTrayShown: oc.input(z.boolean()).output(type<void>()),
  setDockHidden: oc.input(z.boolean()).output(type<void>()),
  newsRetention: oc.output(type<NewsRetentionSettings>()),
  /** Keeps a voice's news this long; a shorter time deletes what is older at once. */
  setNewsRetention: oc
    .input(
      z.object({ voice: z.enum(NewsVoice), retention: newsRetentionSchema })
    )
    .output(type<void>()),
  updates: oc.output(type<UpdateSettings>()),
  setUpdateChecks: oc.input(z.boolean()).output(type<void>()),
  otlp: oc.output(type<OtlpSettings>()),
  /** Sends traces and logs to `endpoint` from now on; `null` stops sending them. */
  setOtlpEndpoint: oc.input(endpointSchema.nullable()).output(type<void>()),
  crashReports: oc.output(type<CrashReportSettings>()),
  /** Starts or stops sending crash reports at once, including what is still queued to send. */
  setCrashReports: oc.input(z.boolean()).output(type<void>()),
  /** Connects the servers in mcp.json on first use. */
  mcp: oc.output(type<McpSettings>()),
  /** Lets the agent do the same with each of a server's `tools`, saved in one write. */
  setMcpToolPolicy: oc
    .input(
      z.object({
        server: mcpNameSchema,
        tools: z.array(mcpNameSchema).min(1).max(1024),
        policy: mcpToolPolicySchema,
      })
    )
    .output(type<void>()),
  /** Saves a secret an entry names as `secret:NAME`; the server reconnects with it. */
  saveMcpSecret: oc
    .input(
      z.object({
        server: mcpNameSchema,
        name: mcpSecretNameSchema,
        value: z.string().trim().min(1).max(4096),
      })
    )
    .output(type<void>()),
  deleteMcpSecret: oc
    .input(z.object({ server: mcpNameSchema, name: mcpSecretNameSchema }))
    .output(type<void>()),
  reconnectMcp: oc.input(mcpNameSchema).output(type<void>()),
  /**
   * Signs in to a remote server in the browser, resolving once the sign-in is saved and the server
   * reconnects, or once it is cancelled. The page the browser lands on is written in `locale`.
   */
  signInMcp: oc
    .input(z.object({ server: mcpNameSchema, locale: localeSchema }))
    .output(type<void>()),
  cancelMcpSignIn: oc.output(type<void>()),
  signOutMcp: oc.input(mcpNameSchema).output(type<void>()),
  about: oc.output(type<AppInfo>()),
  reveal: oc.input(appLocationSchema).output(type<void>()),
  /** Some setting or saved secret changed, here or by hand in the config file. */
  changes: changesContract,
  /** Yields the appearance on every change, whether saved here or by hand in the config file. */
  appearanceChanges: oc.output(asyncIteratorObject(type<Appearance>())),
  /** Yields the code a sign-in under way has for the user to enter on the provider's page. */
  signInCodes: oc.output(asyncIteratorObject(type<SignInCode>())),
};
