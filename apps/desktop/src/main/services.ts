import { join } from "node:path";

import { BrowserWindow, app, nativeTheme, shell } from "electron";
import type { WebContents } from "electron";
import { kebabCase, omit, uniqBy } from "es-toolkit";

import { createPaperBroker } from "@solyx/brokers/paper";
import { Currency, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { OrderDesk } from "@solyx/core/order-desk";
import type { RiskLimits } from "@solyx/core/risk";
import { Session } from "@solyx/core/session";
import { openAgentStore } from "@solyx/db/agent";
import { openCache } from "@solyx/db/cache";
import { openMemory } from "@solyx/db/memory";
import { openNews } from "@solyx/db/news";
import { openResearch } from "@solyx/db/research";
import { openUserData } from "@solyx/db/user";
import { createFinMind } from "@solyx/fundamentals/finmind";
import { createStatGovTw } from "@solyx/macro/stat-gov-tw";

import { marketEvents } from "#shared/ipc/market.ts";
import { memoryEvents } from "#shared/ipc/memory.ts";
import { newsEvents } from "#shared/ipc/news.ts";
import { proposalsEvents } from "#shared/ipc/proposals.ts";
import { researchEvents } from "#shared/ipc/research.ts";
import { AppLocation, Secret, settingsEvents } from "#shared/ipc/settings.ts";
import { updatesEvents } from "#shared/ipc/updates.ts";
import { ColorScheme } from "#shared/palette.ts";

import { createAgentService } from "./modules/agent/agent-service.ts";
import { createMcpServers } from "./modules/agent/mcp-servers.ts";
import { createCalendar } from "./modules/calendar/calendar.ts";
import { createDecisions } from "./modules/decisions/decisions.ts";
import { createFundamentals } from "./modules/fundamentals/fundamentals.ts";
import { openFubonProcess } from "./modules/market/fubon-process.ts";
import { createMarketDataSources } from "./modules/market/market-data-sources.ts";
import { createMarketData } from "./modules/market/market-data.ts";
import { createTradingCalendar } from "./modules/market/trading-calendar.ts";
import { createMemories } from "./modules/memory/memories.ts";
import { createNewsCollector } from "./modules/news/news-collector.ts";
import { createNewsSources } from "./modules/news/news-sources.ts";
import { createNews } from "./modules/news/news.ts";
import { createResearch } from "./modules/research/research.ts";
import { createAppearance } from "./modules/settings/appearance.ts";
import { createConfigFile } from "./modules/settings/config-file.ts";
import { electronCipher } from "./modules/settings/electron-cipher.ts";
import { installationId } from "./modules/settings/installation-id.ts";
import { createSecretStore } from "./modules/settings/secret-store.ts";
import { createAppUpdater } from "./modules/updates/app-updater.ts";
import { createUpdates } from "./modules/updates/updates.ts";
import { createWebSearch } from "./modules/web-search/web-search.ts";
import { createScheduler } from "./scheduler.ts";
import { paintWindow } from "./shell/main-window.ts";

const PAPER_CASH = { [Currency.TWD]: 1_000_000, [Currency.USD]: 30_000 };

// Paper trading is allowed around the clock so the flow can be tried after the close.
const PAPER_LIMITS: RiskLimits = {
  maxOrderNotional: PAPER_CASH,
  allowedSessions: Object.values(Session),
};

/** Pushes to every window, since each may show what changed. */
function broadcast(...push: Parameters<WebContents["send"]>) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(...push);
  }
}

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
    broker: createPaperBroker({
      cash: PAPER_CASH,
      ledger: userData.paperAccount,
    }),
    store: userData.proposals,
    limits: PAPER_LIMITS,
    onChange: () => broadcast(proposalsEvents.onChanged),
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

  const config = createConfigFile(join(configDir, "config.json"));

  config.create();

  const marketData = createMarketData({
    sources: createMarketDataSources({
      config,
      secrets,
      candles: cache.candles,
      fubonLogDir: join(userDataDir, "fubon"),
      openFubonProcess,
    }),
    onSourcesChanged: () => broadcast(marketEvents.onSourcesChanged),
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

  const webSearch = createWebSearch({ config, secrets });

  const newsData = openNews(
    join(userDataDir, "news.sqlite"),
    join(import.meta.dirname, "migrations", "news")
  );

  // Every window hears every write to the agent's memories, whoever made it.
  const memories = createMemories(
    openMemory(
      join(userDataDir, "memory.sqlite"),
      join(import.meta.dirname, "migrations", "memory")
    ),
    () => broadcast(memoryEvents.onChanged)
  );

  const news = createNews({
    sources: createNewsSources(() => webSearch.vendor()),
    store: newsData.store,
    scorer: () => decisions.scorer(),
    marketData,
    onChange: (symbol) => broadcast(newsEvents.onChanged, symbol),
  });

  // One client, so fundamentals and trading days share FinMind's hourly limit.
  const finMind = createFinMind({
    token: () => secrets.get(Secret.FinMindToken),
    plan: () => config.read().providers.finmind.plan,
  });

  const fundamentals = createFundamentals({ providers: [finMind] });

  // The plan and the token set which restrictions FinMind reads, so a change to either reads them again.
  let finMindPlan = config.read().providers.finmind.plan;

  config.onChange(() => {
    const plan = config.read().providers.finmind.plan;

    if (plan === finMindPlan) return;

    finMindPlan = plan;
    fundamentals.forget();
  });

  secrets.onChange((secret) => {
    if (secret === Secret.FinMindToken) fundamentals.forget();
  });

  const tradingDays = createTradingCalendar({ providers: [finMind] });

  const calendar = createCalendar({
    fundamentals,
    macro: [createStatGovTw()],
  });

  // Every window hears every change to the agent's research, whoever made it.
  const research = createResearch(
    openResearch(
      join(userDataDir, "research.sqlite"),
      join(import.meta.dirname, "migrations", "research")
    ),
    { marketData, fundamentals, auditor: () => decisions.claimAuditor() },
    () => broadcast(researchEvents.onChanged)
  );

  const agent = createAgentService({
    config,
    secrets,
    getDeviceId: installationId(join(userDataDir, "installation-id")),
    openExternal,
    skillFolders,
    instructionsFile,
    mcp,
    workspaces: join(userDataDir, "agent-workspaces"),
    async judgeCommand(input, signal) {
      const judgement = await (
        await decisions.commandJudge()
      )?.judge(input, { signal });

      return judgement && omit(judgement, ["model"]);
    },
    conversations: openAgentStore(join(userDataDir, "agent.sqlite")),
    marketData,
    watchlist: () => userData.watchlist.list(),
    news,
    tradingDays,
    web: () => webSearch.vendor(),
    desk,
    memory: memories.store,
    research: research.desk,
    fundamentals,
  });

  /** What the user holds, then what they watch, each once; a broker that cannot be read leaves the watchlist. */
  async function followedListings(): Promise<SymbolRef[]> {
    const held = await desk.account().then(
      ({ positions }) =>
        positions.map(({ instrument: { market, symbol } }) => ({
          market,
          symbol,
        })),
      () => []
    );

    return uniqBy([...held, ...userData.watchlist.list()], symbolKey);
  }

  const newsCollector = createNewsCollector({
    news,
    listings: followedListings,
    collectEveryHours: () => config.read().news.collectEveryHours,
  });

  const updates = createUpdates({
    updater: createAppUpdater(),
    checkEnabled: () => config.read().updates.check,
    onChange: () => broadcast(updatesEvents.onChanged),
  });

  const scheduler = createScheduler();

  scheduler.register("News collection", newsCollector);
  scheduler.register("Update check", updates);

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

  config.onChange(() => broadcast(settingsEvents.onChanged));
  secrets.onChange(() => broadcast(settingsEvents.onChanged));
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
    memories,
    research,
    calendar,
    agent,
    mcp,
    decisions,
    webSearch,
    news,
    newsData,
    updates,
    scheduler,
  };
}

export type Services = ReturnType<typeof createServices>;
