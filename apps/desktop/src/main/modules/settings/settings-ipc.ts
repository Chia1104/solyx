import { BrowserWindow, app, dialog, shell } from "electron";
import type { OpenDialogOptions } from "electron";
import { mapValues } from "es-toolkit";
import * as z from "zod";

import {
  DEFAULT_MODEL,
  agentAuthSchema,
  agentProviderSchema,
  agentThinkingSchema,
} from "@solyx/agent/providers";
import { Market } from "@solyx/core/market";
import { fuglePlanSchema } from "@solyx/market-data/fugle";

import {
  AppLocation,
  FubonFile,
  MarketDataSource,
  Secret,
  Theme,
  settingsChannels,
} from "#shared/ipc/settings.ts";
import type { SettingsApi } from "#shared/ipc/settings.ts";

import { ipcModule } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

// A sign-in's tokens are saved by the sign-in itself, never typed in or replaced from here.
const secretSchema = z.enum(Secret).exclude(["OpenAIChatGPT"]);

const handle = ipcModule<SettingsApi>(settingsChannels, {
  theme: z.tuple([]),
  setTheme: z.tuple([z.enum(Theme)]),
  secrets: z.tuple([]),
  saveSecret: z.tuple([secretSchema, z.string().trim().min(1).max(1024)]),
  deleteSecret: z.tuple([secretSchema]),
  marketData: z.tuple([]),
  setMarketDataSource: z.tuple([
    z.literal(Market.TW),
    z.enum(MarketDataSource),
  ]),
  setFuglePlan: z.tuple([fuglePlanSchema]),
  chooseFubonFile: z.tuple([z.enum(FubonFile)]),
  signInFubon: z.tuple([]),
  agent: z.tuple([]),
  setAgentProvider: z.tuple([agentProviderSchema]),
  setAgentModel: z.tuple([z.string().trim().min(1).max(200)]),
  setAgentThinking: z.tuple([agentThinkingSchema]),
  setAgentAuth: z.tuple([agentAuthSchema]),
  signInSubscription: z.tuple([z.string().min(2).max(35)]),
  cancelSignIn: z.tuple([]),
  signOutSubscription: z.tuple([]),
  cacheUsage: z.tuple([]),
  clearCache: z.tuple([]),
  about: z.tuple([]),
  reveal: z.tuple([z.enum(AppLocation)]),
});

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

export function registerSettingsIpc({
  theme,
  applyTheme,
  secrets,
  config,
  cache,
  home,
  locations,
  applySettings,
  marketData,
  liveCandles,
  agent,
}: Services) {
  handle("theme", async () => theme());

  handle("setTheme", async (next) => {
    config.set(["theme"], next);
    applyTheme();
  });

  handle("secrets", async () => ({
    available: await secrets.available(),
    states: await secrets.states(),
  }));

  // The live stream authenticates once per connection, so a changed key reopens it.
  handle("saveSecret", async (secret, value) => {
    await secrets.save(secret, value);
    await liveCandles.restart();
  });

  handle("deleteSecret", async (secret) => {
    await secrets.delete(secret);
    await liveCandles.restart();
  });

  handle("marketData", () => marketData.status());

  handle("setMarketDataSource", async (market, source) => {
    config.set(["marketData", market], source);
    await applySettings();
  });

  handle("setFuglePlan", async (plan) => {
    config.set(["providers", "fugle", "plan"], plan);
    await applySettings();
  });

  handle("chooseFubonFile", async (file, event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = FUBON_FILE_DIALOG[file];

    const { canceled, filePaths } = await (window
      ? dialog.showOpenDialog(window, options)
      : dialog.showOpenDialog(options));

    const [path] = filePaths;

    if (canceled || path === undefined) return null;

    config.set(["providers", "fubon", file], path);
    await applySettings();

    return path;
  });

  // The stream keeps the session it opened with, so a new sign-in reopens it.
  handle("signInFubon", async () => {
    await marketData.signInFubon();
    await liveCandles.restart();
  });

  handle("agent", () => agent.models.settings());

  // A model id means nothing to another provider, so switching starts from its default.
  handle("setAgentProvider", async (provider) => {
    config.set(["agent", "provider"], provider);
    config.set(["agent", "model"], DEFAULT_MODEL[provider]);
  });

  handle("setAgentModel", async (model) => {
    config.set(["agent", "model"], model);
  });

  handle("setAgentThinking", async (thinking) => {
    config.set(["agent", "thinking"], thinking);
  });

  handle("setAgentAuth", async (auth) => {
    config.set(["agent", "auth"], auth);
  });

  handle("signInSubscription", (locale) => agent.models.signIn(locale));

  handle("cancelSignIn", async () => agent.models.cancelSignIn());

  handle("signOutSubscription", () => agent.models.signOut());

  handle("cacheUsage", async () => cache.usage());

  handle("clearCache", async () => cache.clear());

  handle("about", async () => ({
    name: app.getName(),
    version: app.getVersion(),
    packaged: app.isPackaged,
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    os: `${OS_NAME[process.platform] ?? process.platform} ${process.getSystemVersion()} (${process.arch})`,
    locations: mapValues(locations, (path) => path.replace(home, "~")),
  }));

  handle("reveal", async (location) =>
    shell.showItemInFolder(locations[location])
  );
}
