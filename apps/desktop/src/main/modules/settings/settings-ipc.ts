import { BrowserWindow, dialog } from "electron";
import type { OpenDialogOptions } from "electron";
import * as z from "zod";

import { Market } from "@solyx/core/market";
import { fuglePlanSchema } from "@solyx/market-data/fugle";

import {
  FubonFile,
  MarketDataSource,
  Secret,
  settingsChannels,
} from "#shared/ipc/settings.ts";
import type { SettingsApi } from "#shared/ipc/settings.ts";

import { ipcModule } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const secretSchema = z.enum(Secret);

const handle = ipcModule<SettingsApi>(settingsChannels, {
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
});

const FUBON_FILE_DIALOG: Record<FubonFile, OpenDialogOptions> = {
  [FubonFile.Sdk]: { properties: ["openDirectory"] },
  [FubonFile.Certificate]: {
    properties: ["openFile"],
    filters: [{ name: "PKCS #12", extensions: ["pfx", "p12"] }],
  },
};

export function registerSettingsIpc({
  secrets,
  config,
  configFile,
  applySettings,
  marketData,
  liveCandles,
}: Services) {
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

  handle("marketData", async () => ({
    file: configFile,
    ...(await marketData.status()),
  }));

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
    const accounts = await marketData.signInFubon();

    await liveCandles.restart();

    return accounts;
  });
}
