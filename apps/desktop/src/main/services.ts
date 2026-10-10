import { dirname, join } from "node:path";

import { BrowserWindow, app, nativeTheme, shell } from "electron";
import type { WebContents } from "electron";
import { omit, uniqBy } from "es-toolkit";

import { createPaperBroker } from "@solyx/brokers/paper";
import { changesSince } from "@solyx/core/changes";
import { Currency, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { OrderDesk } from "@solyx/core/order-desk";
import type { RiskLimits } from "@solyx/core/risk";
import { CollectionJob } from "@solyx/core/schedule";
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
import { schedulesEvents } from "#shared/ipc/schedules.ts";
import {
  AppLocation,
  Secret,
  resolveLocale,
  settingsEvents,
} from "#shared/ipc/settings.ts";
import { themesEvents } from "#shared/ipc/themes.ts";
import { updatesEvents } from "#shared/ipc/updates.ts";
import { ColorScheme } from "#shared/palette.ts";

import { createAgentService } from "./modules/agent/agent-service.ts";
import { createMcpServers } from "./modules/agent/mcp-servers.ts";
import { createCalendar } from "./modules/calendar/calendar.ts";
import { reportError } from "./modules/crash-reports/crash-reports.ts";
import { createDecisions } from "./modules/decisions/decisions.ts";
import { createEmbeddings } from "./modules/embeddings/embeddings.ts";
import { createFlows } from "./modules/flows/flows.ts";
import { createFundamentals } from "./modules/fundamentals/fundamentals.ts";
import { openFubonProcess } from "./modules/market/fubon-process.ts";
import { createMarketDataSources } from "./modules/market/market-data-sources.ts";
import { createMarketData } from "./modules/market/market-data.ts";
import { createScheduleDays } from "./modules/market/schedule-days.ts";
import { createTradingCalendar } from "./modules/market/trading-calendar.ts";
import { createMemories } from "./modules/memory/memories.ts";
import { createNewsCollector } from "./modules/news/news-collector.ts";
import { createNewsSources } from "./modules/news/news-sources.ts";
import { createNews } from "./modules/news/news.ts";
import { createResearch } from "./modules/research/research.ts";
import { createCollections } from "./modules/schedules/collections.ts";
import { createSchedules } from "./modules/schedules/schedules.ts";
import { createAppearance } from "./modules/settings/appearance.ts";
import { CATALOGS } from "./modules/settings/catalogs.ts";
import type { ConfigFile } from "./modules/settings/config-file.ts";
import { electronCipher } from "./modules/settings/electron-cipher.ts";
import { installationId } from "./modules/settings/installation-id.ts";
import { createSecretStore } from "./modules/settings/secret-store.ts";
import { createTelemetry } from "./modules/telemetry/telemetry.ts";
import { createThemes } from "./modules/themes/themes.ts";
import { createTray } from "./modules/tray/tray.ts";
import { createAppUpdater } from "./modules/updates/app-updater.ts";
import { createUpdates } from "./modules/updates/updates.ts";
import { createWebSearch } from "./modules/web-search/web-search.ts";
import { createScheduler } from "./scheduler.ts";
import { appChannel } from "./shell/app-channel.ts";
import { paintWindow, showMainWindow } from "./shell/main-window.ts";
import { createTrayShell } from "./shell/tray-icon.ts";

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
export function createServices(config: ConfigFile) {
  const userDataDir = app.getPath("userData");
  const home = app.getPath("home");
  const configDir = dirname(config.file);

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

  config.create();

  const telemetry = createTelemetry({
    config,
    secrets,
    version: app.getVersion(),
    channel: appChannel(),
    report: reportError,
  });

  const { diagnostics } = telemetry;

  const marketData = createMarketData({
    sources: createMarketDataSources({
      config,
      secrets,
      candles: cache.candles,
      fubonLogDir: join(userDataDir, "fubon"),
      openFubonProcess,
    }),
    onSourcesChanged: () => broadcast(marketEvents.onSourcesChanged),
    diagnostics,
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

  const embeddings = createEmbeddings({ config, secrets });

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
    diagnostics,
    sources: createNewsSources(() => webSearch.vendor()),
    store: newsData.store,
    scorer: () => decisions.scorer(),
    embedder: () => embeddings.embedder(),
    localEmbedder: () => embeddings.localEmbedder(),
    marketData,
    onChange(symbol) {
      broadcast(newsEvents.onChanged, symbol);
      void research.watch(symbol);
    },
  });

  // One client, so fundamentals, flows and trading days share FinMind's hourly limit.
  const finMind = createFinMind({
    token: () => secrets.get(Secret.FinMindToken),
    plan: () => config.read().providers.finmind.plan,
  });

  const fundamentals = createFundamentals({
    providers: [finMind],
    answers: cache.answers,
  });

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

  const flows = createFlows({ providers: [finMind], answers: cache.answers });

  const tradingDays = createTradingCalendar({
    providers: [finMind],
    answers: cache.answers,
  });

  // Every window hears every change to the agent's research, whoever made it.
  const researchData = openResearch(
    join(userDataDir, "research.sqlite"),
    join(import.meta.dirname, "migrations", "research")
  );

  const research = createResearch(
    researchData,
    {
      marketData,
      fundamentals,
      auditor: () => decisions.claimAuditor(),
      news: newsData.store,
      embedder: () => embeddings.localEmbedder(),
      diagnostics,
    },
    () => broadcast(researchEvents.onChanged)
  );

  const calendar = createCalendar({
    fundamentals,
    macro: [createStatGovTw()],
    reports: researchData.store,
    answers: cache.answers,
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

  // What the main process writes itself is in the language the windows show.
  const tray = createTray({
    settings: () => config.read().tray,
    copy: () =>
      CATALOGS[resolveLocale(appearance.read().language, app.getLocale())].tray,
    shell: createTrayShell(() => showMainWindow(windowColors)),
  });

  const scheduleDays = createScheduleDays({ tradingDays, diagnostics });

  const themes = createThemes({
    store: userData.themes,
    web: () => webSearch.vendor(),
    auditor: () => decisions.claimAuditor(),
    plan: () => config.read().collection[CollectionJob.Themes],
    days: scheduleDays,
    diagnostics,
    onChange: () => broadcast(themesEvents.onChanged),
  });

  const agent = createAgentService({
    config,
    secrets,
    tracer: telemetry.tracer,
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
    calendar,
    web: () => webSearch.vendor(),
    desk,
    memory: memories.store,
    localEmbedder: () => embeddings.localEmbedder(),
    research: research.desk,
    themes: themes.desk,
    fundamentals,
    flows,
    setup: {
      appearance,
      marketData,
      webSearch,
      decisions,
      embeddings,
      schedules: userData.schedules,
      themes: userData.themes,
      version: app.getVersion(),
      home,
    },
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
    diagnostics,
    news,
    listings: followedListings,
    plan: () => config.read().collection[CollectionJob.News],
    days: scheduleDays,
  });

  const collections = createCollections({
    config,
    collectors: {
      [CollectionJob.News]: newsCollector,
      [CollectionJob.Themes]: themes,
    },
  });

  const updates = createUpdates({
    updater: createAppUpdater(),
    checkEnabled: () => config.read().updates.check,
    onChange: () => broadcast(updatesEvents.onChanged),
  });

  const schedules = createSchedules({
    store: userData.schedules,
    agent,
    days: scheduleDays,
    async changes(since) {
      const followed = await followedListings();

      return changesSince(since, Date.now(), {
        reports: followed.flatMap((symbol) => {
          const report = researchData.store.report(symbol);

          return report
            ? [
                {
                  report,
                  checks: researchData.store.falsifierChecks(
                    symbol,
                    report.revision
                  ),
                },
              ]
            : [];
        }),
        themes: themes.desk.list(),
      });
    },
    diagnostics,
    onChange: () => broadcast(schedulesEvents.onChanged),
  });

  const scheduler = createScheduler({ telemetry });

  scheduler.register("News collection", newsCollector.work);
  scheduler.register("Update check", updates);
  scheduler.register("Scheduled tasks", schedules.work);
  scheduler.register("Change watch", schedules.changeWork);
  scheduler.register("Theme watch", themes.work);

  nativeTheme.themeSource = appearance.read().theme;

  config.onChange(() => broadcast(settingsEvents.onChanged));
  // A collection's plan lives in the config file, so whoever shows the plans hears of every edit.
  config.onChange(() => broadcast(schedulesEvents.onChanged));
  secrets.onChange(() => broadcast(settingsEvents.onChanged));
  // Its switches and its menu's language both live in the config file.
  config.onChange(() => tray.sync());
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
    flows,
    agent,
    telemetry,
    mcp,
    decisions,
    embeddings,
    webSearch,
    news,
    newsData,
    updates,
    schedules,
    collections,
    themes,
    scheduler,
    tray,
  };
}

export type Services = ReturnType<typeof createServices>;
