import { BrowserWindow, app, dialog, shell } from "electron";
import type { OpenDialogOptions } from "electron";
import * as z from "zod";

import {
  mcpSecretNameSchema,
  mcpToolPolicySchema,
} from "@solyx/agent/mcp-config";
import {
  agentAuthSchema,
  agentProviderSchema,
  agentThinkingSchema,
} from "@solyx/agent/providers";
import { Market } from "@solyx/core/market";
import { decisionsProviderSchema } from "@solyx/decisions/provider";
import { fuglePlanSchema } from "@solyx/market-data/fugle";
import { webSearchProviderSchema } from "@solyx/web-search/provider";

import {
  FubonFile,
  appLocationSchema,
  enteredSecretSchema,
  fubonFileSchema,
  localeSchema,
  marketDataSourceSchema,
  newsIntervalSchema,
  priceColorsSchema,
  settingsChannels,
  themeSchema,
} from "#shared/ipc/settings.ts";
import type { SettingsApi } from "#shared/ipc/settings.ts";
import {
  colorSchemeSchema,
  hexColorSchema,
  paletteTokenSchema,
} from "#shared/palette.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

import { endpointSchema } from "./config-file.ts";
import { createSettingsApi } from "./settings-api.ts";
import type { SettingsShell } from "./settings-api.ts";

// An MCP server's or tool's name, as mcp.json and the server give it.
const mcpNameSchema = z.string().min(1).max(128);

// A palette's id, which a person may have written into the config file.
const paletteIdSchema = z.string().min(1).max(128);

const paletteNameSchema = z.string().trim().min(1).max(60);

const schemas = {
  appearance: z.tuple([]),
  setTheme: z.tuple([themeSchema]),
  setPalette: z.tuple([colorSchemeSchema, paletteIdSchema]),
  copyPalette: z.tuple([paletteIdSchema, paletteNameSchema]),
  renamePalette: z.tuple([paletteIdSchema, paletteNameSchema]),
  setPaletteColor: z.tuple([
    paletteIdSchema,
    colorSchemeSchema,
    paletteTokenSchema,
    hexColorSchema.nullable(),
  ]),
  deletePalette: z.tuple([paletteIdSchema]),
  setPriceColors: z.tuple([priceColorsSchema]),
  secrets: z.tuple([]),
  saveSecret: z.tuple([
    enteredSecretSchema,
    z.string().trim().min(1).max(1024),
  ]),
  deleteSecret: z.tuple([enteredSecretSchema]),
  marketData: z.tuple([]),
  setMarketDataSource: z.tuple([z.literal(Market.TW), marketDataSourceSchema]),
  setFuglePlan: z.tuple([fuglePlanSchema]),
  chooseFubonFile: z.tuple([fubonFileSchema]),
  signInFubon: z.tuple([]),
  agent: z.tuple([]),
  setAgentProviderEnabled: z.tuple([agentProviderSchema, z.boolean()]),
  setAgentProvider: z.tuple([agentProviderSchema]),
  setAgentModel: z.tuple([z.string().trim().min(1).max(200)]),
  setAgentThinking: z.tuple([agentThinkingSchema]),
  setAgentAuth: z.tuple([agentAuthSchema]),
  setAgentEndpoint: z.tuple([agentProviderSchema, endpointSchema.nullable()]),
  saveAgentKey: z.tuple([
    agentProviderSchema,
    z.string().trim().min(1).max(1024),
  ]),
  deleteAgentKey: z.tuple([agentProviderSchema]),
  signInSubscription: z.tuple([agentProviderSchema, localeSchema]),
  cancelSignIn: z.tuple([]),
  signOutSubscription: z.tuple([agentProviderSchema]),
  news: z.tuple([]),
  setNewsCollectEveryHours: z.tuple([newsIntervalSchema]),
  webSearch: z.tuple([]),
  setWebSearchProvider: z.tuple([webSearchProviderSchema]),
  saveWebSearchKey: z.tuple([
    webSearchProviderSchema,
    z.string().trim().min(1).max(1024),
  ]),
  deleteWebSearchKey: z.tuple([webSearchProviderSchema]),
  decisions: z.tuple([]),
  setDecisionsProvider: z.tuple([decisionsProviderSchema]),
  setDecisionsModel: z.tuple([
    decisionsProviderSchema,
    z.string().trim().min(1).max(200).nullable(),
  ]),
  setDecisionsBaseURL: z.tuple([
    decisionsProviderSchema,
    endpointSchema.nullable(),
  ]),
  setDecisionsAccountId: z.tuple([
    z.string().trim().min(1).max(200).nullable(),
  ]),
  agentSkills: z.tuple([]),
  setSharedSkill: z.tuple([z.string().min(1).max(64), z.boolean()]),
  setAgentShell: z.tuple([z.boolean()]),
  memory: z.tuple([]),
  setMemoryEnabled: z.tuple([z.boolean()]),
  mcp: z.tuple([]),
  setMcpToolPolicy: z.tuple([
    mcpNameSchema,
    z.array(mcpNameSchema).min(1).max(1024),
    mcpToolPolicySchema,
  ]),
  saveMcpSecret: z.tuple([
    mcpNameSchema,
    mcpSecretNameSchema,
    z.string().trim().min(1).max(4096),
  ]),
  deleteMcpSecret: z.tuple([mcpNameSchema, mcpSecretNameSchema]),
  reconnectMcp: z.tuple([mcpNameSchema]),
  signInMcp: z.tuple([mcpNameSchema, localeSchema]),
  cancelMcpSignIn: z.tuple([]),
  signOutMcp: z.tuple([mcpNameSchema]),
  about: z.tuple([]),
  reveal: z.tuple([appLocationSchema]),
};

// People know these by name rather than by Node's platform ids.
const OS_NAME: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

const FUBON_FILE_DIALOG: Record<FubonFile, OpenDialogOptions> = {
  [FubonFile.Sdk]: { properties: ["openDirectory"] },
  [FubonFile.Certificate]: {
    properties: ["openFile"],
    filters: [{ name: "PKCS #12", extensions: ["pfx", "p12"] }],
  },
};

const electronShell: SettingsShell = {
  async chooseFubonFile(file, event) {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = FUBON_FILE_DIALOG[file];

    const { canceled, filePaths } = await (window
      ? dialog.showOpenDialog(window, options)
      : dialog.showOpenDialog(options));

    const [path] = filePaths;

    return canceled || path === undefined ? null : path;
  },

  showItemInFolder: (path) => shell.showItemInFolder(path),

  about: () => ({
    name: app.getName(),
    version: app.getVersion(),
    packaged: app.isPackaged,
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    os: `${OS_NAME[process.platform] ?? process.platform} ${process.getSystemVersion()} (${process.arch})`,
  }),
};

export function registerSettingsIpc(services: Services) {
  bindIpc<SettingsApi>(
    settingsChannels,
    schemas,
    createSettingsApi({ ...services, shell: electronShell })
  );
}
