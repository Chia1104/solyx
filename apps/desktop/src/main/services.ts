import { join } from "node:path";

import { BrowserWindow, app, nativeTheme, shell } from "electron";
import { kebabCase } from "es-toolkit";

import { AgentAuth } from "@solyx/agent/providers";
import { createPaperBroker } from "@solyx/brokers/paper";
import { Currency } from "@solyx/core/market";
import { OrderDesk } from "@solyx/core/order-desk";
import type { RiskLimits } from "@solyx/core/risk";
import { Session } from "@solyx/core/session";
import { openAgentStore } from "@solyx/db/agent";
import { openCache } from "@solyx/db/cache";
import { openNews } from "@solyx/db/news";
import { openUserData } from "@solyx/db/user";

import { marketEvents } from "#shared/ipc/market.ts";
import { newsEvents } from "#shared/ipc/news.ts";
import { AppLocation, settingsEvents } from "#shared/ipc/settings.ts";
import { ColorScheme } from "#shared/palette.ts";

import { agentAuth } from "./modules/agent/agent-models.ts";
import { createAgentService } from "./modules/agent/agent-service.ts";
import { createMcpServers } from "./modules/agent/mcp-servers.ts";
import { createDecisions } from "./modules/decisions/decisions.ts";
import { openFubonProcess } from "./modules/market/fubon-process.ts";
import { createMarketDataSources } from "./modules/market/market-data-sources.ts";
import { createMarketData } from "./modules/market/market-data.ts";
import { createNewsCollector } from "./modules/news/news-collector.ts";
import { createNews } from "./modules/news/news.ts";
import { createAppearance } from "./modules/settings/appearance.ts";
import { createConfigFile } from "./modules/settings/config-file.ts";
import { createCredentialStore } from "./modules/settings/credential-store.ts";
import { electronCipher } from "./modules/settings/electron-cipher.ts";
import { installationId } from "./modules/settings/installation-id.ts";
import { createSecretStore } from "./modules/settings/secret-store.ts";
import { paintWindow } from "./shell/main-window.ts";

const PAPER_CASH = { [Currency.TWD]: 1_000_000, [Currency.USD]: 30_000 };

// Paper trading is allowed around the clock so the flow can be tried after the close.
const PAPER_LIMITS: RiskLimits = {
  maxOrderNotional: PAPER_CASH,
  allowedSessions: Object.values(Session),
};

/** Composition root. A live broker is only ever wired here after the user explicitly turns it on. */
export function createServices() {
  const userDataDir = app.getPath("userData");
  const home = app.getPath("home");

  // Settings a person edits live in a dotfolder named after the app, so each channel keeps its own.
  const configDir = join(home, `.${kebabCase(app.getName())}`);

  const userData = openUserData(
    join(userDataDir, "user.sqlite"),
    join(import.meta.dirname, "migrations", "user")
  );

  const desk = new OrderDesk({
    broker: createPaperBroker({ cash: PAPER_CASH }),
    store: userData.proposals,
    limits: PAPER_LIMITS,
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

  const marketData = createMarketData({
    sources: createMarketDataSources({
      config,
      secrets,
      candles: cache.candles,
      fubonLogDir: join(userDataDir, "fubon"),
      openFubonProcess,
    }),
    onSourcesChanged() {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(marketEvents.onSourcesChanged);
      }
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

  const decisions = createDecisions({ config, secrets });

  const news = createNews({
    secrets,
    store: openNews(
      join(userDataDir, "news.sqlite"),
      join(import.meta.dirname, "migrations", "news")
    ).store,
    // Every window's chart may show the listing.
    onChange(symbol) {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(newsEvents.onChanged, symbol);
      }
    },
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
    marketData,
    watchlist: () => userData.watchlist.list(),
    newsSources: () => news.sources(),
    newsStore: news.store,
    scorer: () => decisions.scorer(),
    desk,
  });

  const newsCollector = createNewsCollector({
    sources: () => news.sources(),
    store: news.store,
    scorer: () => decisions.scorer(),
    marketData,
    watchlist: () => userData.watchlist.list(),
    collectEveryHours: () => config.read().news.collectEveryHours,
  });

  const appearance = createAppearance({
    config,
    // Windows and their renderers' prefers-color-scheme follow themeSource; the rest is pushed to
    // every renderer, so a hand edit applies as the settings page's does.
    onChange(next) {
      nativeTheme.themeSource = next.theme;

      for (const window of BrowserWindow.getAllWindows()) {
        paintWindow(window, windowColors());
        window.webContents.send(settingsEvents.onAppearance, next);
      }
    },
  });

  /** The palette windows show now, in the scheme the theme or the computer picks. */
  function windowColors() {
    return appearance.colors(
      nativeTheme.shouldUseDarkColors ? ColorScheme.Dark : ColorScheme.Light
    );
  }

  nativeTheme.themeSource = appearance.read().theme;
  config.watch();

  return {
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
    appearance,
    windowColors,
    marketData,
    userData,
    agent,
    mcp,
    decisions,
    news,
    newsCollector,
  };
}

export type Services = ReturnType<typeof createServices>;
