import { join } from "node:path";

import { BrowserWindow, app, nativeTheme, shell } from "electron";
import { isEqual, kebabCase } from "es-toolkit";

import { AgentAuth } from "@solyx/agent/providers";
import { createPaperBroker } from "@solyx/brokers/paper";
import { Currency } from "@solyx/core/market";
import { OrderDesk } from "@solyx/core/order-desk";
import type { RiskLimits } from "@solyx/core/risk";
import { Session, getSession } from "@solyx/core/session";
import { openAgentStore } from "@solyx/db/agent";
import { openCache } from "@solyx/db/cache";
import { openUserData } from "@solyx/db/user";

import { AppLocation, settingsEvents } from "#shared/ipc/settings.ts";

import { agentAuth } from "./modules/agent/agent-models.ts";
import { createAgentService } from "./modules/agent/agent-service.ts";
import { createMcpServers } from "./modules/agent/mcp-servers.ts";
import { createLiveCandles } from "./modules/market/live-candles.ts";
import { createMarketDataSources } from "./modules/market/market-data-sources.ts";
import { createConfigFile } from "./modules/settings/config-file.ts";
import { createCredentialStore } from "./modules/settings/credential-store.ts";
import { electronCipher } from "./modules/settings/electron-cipher.ts";
import { installationId } from "./modules/settings/installation-id.ts";
import { createSecretStore } from "./modules/settings/secret-store.ts";

const PAPER_CASH = { [Currency.TWD]: 1_000_000, [Currency.USD]: 30_000 };

// Paper trading is allowed around the clock so the flow can be tried after the close.
const PAPER_LIMITS: RiskLimits = {
  maxOrderNotional: PAPER_CASH,
  allowedSessions: Object.values(Session),
};

/** Composition root. A live broker is only ever wired here after the user explicitly turns it on. */
export function createServices() {
  const broker = createPaperBroker({ cash: PAPER_CASH });
  const userDataDir = app.getPath("userData");
  const home = app.getPath("home");

  // Settings a person edits live in a dotfolder named after the app, so each channel keeps its own.
  const configDir = join(home, `.${kebabCase(app.getName())}`);

  const userData = openUserData(
    join(userDataDir, "user.sqlite"),
    join(import.meta.dirname, "migrations", "user")
  );

  const desk = new OrderDesk({
    broker,
    store: userData.proposals,
    limits: PAPER_LIMITS,
    // No quote feed yet, so market orders are rejected for lack of a reference price.
    riskContext: async (order) => ({
      session: getSession(order.instrument.market),
    }),
  });

  const secrets = createSecretStore(
    join(userDataDir, "secrets.json"),
    electronCipher
  );

  const cache = openCache(
    join(userDataDir, "cache.sqlite"),
    // vp pack copies the migrations next to the bundle; see vite.config.ts.
    join(import.meta.dirname, "migrations", "cache")
  );

  const config = createConfigFile(join(configDir, "config.jsonc"));

  config.create();

  const marketData = createMarketDataSources({
    config,
    secrets,
    candles: cache.candles,
    fubonLogDir: join(userDataDir, "fubon"),
  });

  const liveCandles = createLiveCandles({
    openStream: () => marketData.openStream(),
    async dailyCandles(request) {
      const provider = await marketData.provider(request.symbol.market);

      return provider ? provider.getCandles(request) : [];
    },
  });

  // The user's own skills and instructions sit beside the config file they edit.
  const skillFolders = {
    solyx: join(configDir, "skills"),
    shared: join(home, ".agents", "skills"),
  };

  const instructionsFile = join(configDir, "AGENTS.md");

  const openExternal = (url: string) => void shell.openExternal(url);

  const mcp = createMcpServers({
    file: join(configDir, "mcp.json"),
    config,
    secrets,
    version: app.getVersion(),
    openExternal,
  });

  const agent = createAgentService({
    config,
    secrets,
    credentials: createCredentialStore(
      secrets,
      (provider) => agentAuth(config, provider) === AgentAuth.Subscription
    ),
    getDeviceId: installationId(join(userDataDir, "installation-id")),
    openExternal,
    skillFolders,
    instructionsFile,
    mcp,
    conversations: openAgentStore(join(userDataDir, "agent.sqlite")),
    marketData: (market) => marketData.provider(market),
    watchlist: () => userData.watchlist.list(),
    broker,
    desk,
  });

  let appliedStreamSettings = marketData.streamSettings();

  // Sources and plans change from the settings page or a hand edit; the live stream follows either.
  async function applySettings() {
    const next = marketData.streamSettings();

    if (isEqual(next, appliedStreamSettings)) return;

    appliedStreamSettings = next;
    await liveCandles.restart();
  }

  const appearance = () => config.read().appearance;

  let appliedAppearance = appearance();

  // Windows and their renderers' prefers-color-scheme follow themeSource; the rest is pushed to
  // every renderer, so a hand edit applies as the settings page's does.
  function applyAppearance() {
    const next = appearance();

    nativeTheme.themeSource = next.theme;

    if (isEqual(next, appliedAppearance)) return;

    appliedAppearance = next;

    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(settingsEvents.onAppearance, next);
    }
  }

  applyAppearance();

  config.watch(() => {
    applyAppearance();
    void applySettings();
  });

  return {
    broker,
    desk,
    secrets,
    config,
    cache,
    home,
    skillFolders,
    instructionsFile,
    locations: {
      [AppLocation.Data]: userDataDir,
      [AppLocation.Config]: config.file,
      [AppLocation.Skills]: skillFolders.solyx,
      [AppLocation.Mcp]: mcp.file,
    },
    applySettings,
    appearance,
    applyAppearance,
    marketData,
    liveCandles,
    userData,
    agent,
    mcp,
  };
}

export type Services = ReturnType<typeof createServices>;
