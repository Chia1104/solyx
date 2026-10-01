import { dirname, join } from "node:path";

import { app, nativeTheme, shell } from "electron";
import { kebabCase } from "es-toolkit";

import { AgentAuth } from "@solyx/agent/providers";
import { createPaperBroker } from "@solyx/brokers/paper";
import { OrderDesk } from "@solyx/core/order-desk";
import type { RiskLimits } from "@solyx/core/risk";
import { Session, getSession } from "@solyx/core/session";
import { openAgentStore } from "@solyx/db/agent";
import { openCache } from "@solyx/db/cache";
import { openUserData } from "@solyx/db/user";

import { AppLocation, Theme } from "#shared/ipc/settings.ts";

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
import { SignInFlow, signInPage } from "./modules/settings/sign-in-page.ts";

const PAPER_CASH = { TWD: 1_000_000, USD: 30_000 };

// Paper trading is allowed around the clock so the flow can be tried after the close.
const PAPER_LIMITS: RiskLimits = {
  maxOrderNotional: PAPER_CASH,
  allowedSessions: Object.values(Session),
};

/** Composition root. A live broker is only ever wired here after the user explicitly turns it on. */
export function createServices() {
  const broker = createPaperBroker({ cash: PAPER_CASH });

  const userData = openUserData(
    join(app.getPath("userData"), "user.sqlite"),
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
    join(app.getPath("userData"), "secrets.json"),
    electronCipher
  );

  const cache = openCache(
    join(app.getPath("userData"), "cache.sqlite"),
    // vp pack copies the migrations next to the bundle; see vite.config.ts.
    join(import.meta.dirname, "migrations", "cache")
  );

  const home = app.getPath("home");

  // Settings a person edits live in a dotfolder named after the app, so each channel keeps its own.
  const config = createConfigFile(
    join(home, `.${kebabCase(app.getName())}`, "config.jsonc")
  );

  config.create();

  const marketData = createMarketDataSources({
    config,
    secrets,
    candles: cache.candles,
    fubonLogDir: join(app.getPath("userData"), "fubon"),
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
    solyx: join(dirname(config.file), "skills"),
    shared: join(home, ".agents", "skills"),
  };

  const openExternal = (url: string) => void shell.openExternal(url);

  const mcp = createMcpServers({
    file: join(dirname(config.file), "mcp.json"),
    config,
    secrets,
    version: app.getVersion(),
    openExternal,
    signInPage: (locale, outcome, detail) =>
      signInPage(locale, SignInFlow.Mcp, outcome, detail),
  });

  const agent = createAgentService({
    config,
    secrets,
    credentials: createCredentialStore(
      secrets,
      (provider) => agentAuth(config, provider) === AgentAuth.Subscription
    ),
    getDeviceId: installationId(
      join(app.getPath("userData"), "installation-id")
    ),
    openExternal,
    signInPage: (locale, outcome, detail) =>
      signInPage(locale, SignInFlow.ChatGPT, outcome, detail),
    skillFolders,
    instructionsFile: join(dirname(config.file), "AGENTS.md"),
    mcp,
    conversations: openAgentStore(
      join(app.getPath("userData"), "agent.sqlite")
    ),
    marketData: (market) => marketData.provider(market),
    watchlist: () => userData.watchlist.list(),
    broker,
    desk,
  });

  let appliedStreamSettings = marketData.streamSettings();

  // Sources and plans change from the settings page or a hand edit; the live stream follows either.
  async function applySettings() {
    const next = marketData.streamSettings();

    if (next === appliedStreamSettings) return;

    appliedStreamSettings = next;
    await liveCandles.restart();
  }

  const theme = () => config.read().theme ?? Theme.System;

  // Windows and their renderers' prefers-color-scheme follow themeSource.
  const applyTheme = () => {
    nativeTheme.themeSource = theme();
  };

  applyTheme();

  config.watch(() => {
    applyTheme();
    void applySettings();
  });

  return {
    broker,
    desk,
    secrets,
    config,
    cache,
    home,
    locations: {
      [AppLocation.Data]: app.getPath("userData"),
      [AppLocation.Config]: config.file,
      [AppLocation.Skills]: skillFolders.solyx,
      [AppLocation.Mcp]: mcp.file,
    },
    applySettings,
    theme,
    applyTheme,
    marketData,
    liveCandles,
    userData,
    agent,
    mcp,
  };
}

export type Services = ReturnType<typeof createServices>;
