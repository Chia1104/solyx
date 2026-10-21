import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { MemoryPublisher } from "@orpc/publisher/memory";
import { BrowserWindow, app, nativeTheme, shell } from "electron";
import { debounce, kebabCase, omit, uniqBy } from "es-toolkit";

import { createFubonBroker } from "@solyx/brokers/fubon";
import { createPaperBroker } from "@solyx/brokers/paper";
import { Interval } from "@solyx/core/candles";
import { changesSince, watchesListings } from "@solyx/core/changes";
import { Currency, symbolKey, symbolLabel } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { OrderDesk, ProposalStatus } from "@solyx/core/order-desk";
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
import { createSitca } from "@solyx/fundamentals/sitca";
import { createTwExchanges } from "@solyx/fundamentals/tw-exchanges";
import { createDgbas } from "@solyx/macro/dgbas";
import { createStatGovTw } from "@solyx/macro/stat-gov-tw";

import type { Approval } from "#shared/inbox.ts";
import { ColorScheme } from "#shared/palette.ts";
import {
  AppLocation,
  Secret,
  TradingBroker,
  resolveLocale,
  resolveTimeZone,
} from "#shared/settings.ts";

import { createAgentService } from "./modules/agent/agent-service.ts";
import { createMcpServers } from "./modules/agent/mcp-servers.ts";
import { createBackupThreads } from "./modules/backup/backup-threads.ts";
import { createBackups } from "./modules/backup/backups.ts";
import { settleRestore, takeRestore } from "./modules/backup/staged-restore.ts";
import { createCalendar } from "./modules/calendar/calendar.ts";
import { reportError } from "./modules/crash-reports/crash-reports.ts";
import { createDecisions } from "./modules/decisions/decisions.ts";
import { createEmbeddings } from "./modules/embeddings/embeddings.ts";
import { createFlows } from "./modules/flows/flows.ts";
import { createFundamentals } from "./modules/fundamentals/fundamentals.ts";
import { createInbox } from "./modules/inbox/inbox.ts";
import { createMacro } from "./modules/macro/macro.ts";
import { openFubonProcess } from "./modules/market/fubon-process.ts";
import { createMarketDataSources } from "./modules/market/market-data-sources.ts";
import { createMarketData } from "./modules/market/market-data.ts";
import { createScheduleDays } from "./modules/market/schedule-days.ts";
import {
  createMarketDays,
  createTradingCalendar,
  marketSessions,
} from "./modules/market/trading-calendar.ts";
import { createMemories } from "./modules/memory/memories.ts";
import { createNewsCollector } from "./modules/news/news-collector.ts";
import { createNewsRetention } from "./modules/news/news-retention.ts";
import { createNewsSources } from "./modules/news/news-sources.ts";
import { createNews } from "./modules/news/news.ts";
import { createResearch } from "./modules/research/research.ts";
import { createCollections } from "./modules/schedules/collections.ts";
import { createSchedules } from "./modules/schedules/schedules.ts";
import { createAppearance } from "./modules/settings/appearance.ts";
import type { ConfigFile } from "./modules/settings/config-file.ts";
import { electronCipher } from "./modules/settings/electron-cipher.ts";
import { installationId } from "./modules/settings/installation-id.ts";
import { createMandateStore } from "./modules/settings/mandate-store.ts";
import { createSecretStore } from "./modules/settings/secret-store.ts";
import { createStorageApi } from "./modules/storage/storage-api.ts";
import { createTelemetry } from "./modules/telemetry/telemetry.ts";
import { createThemes } from "./modules/themes/themes.ts";
import { createTray } from "./modules/tray/tray.ts";
import type { TrayState } from "./modules/tray/tray.ts";
import { createAppUpdater } from "./modules/updates/app-updater.ts";
import { createUpdates } from "./modules/updates/updates.ts";
import { createWatchlist } from "./modules/watchlist/watchlist.ts";
import { createWebSearch } from "./modules/web-search/web-search.ts";
import { createWorkspace } from "./modules/workspace/workspace.ts";
import type { WindowEvents } from "./rpc/window-events.ts";
import { createScheduler } from "./scheduler.ts";
import { appChannel } from "./shell/app-channel.ts";
import { chromiumFetch } from "./shell/chromium-fetch.ts";
import { paintWindow, showMainWindow } from "./shell/main-window.ts";
import { settingsShell } from "./shell/settings-shell.ts";
import { createTrayShell } from "./shell/tray-icon.ts";

const PAPER_CASH = { [Currency.TWD]: 1_000_000, [Currency.USD]: 30_000 };

// Paper trading is allowed around the clock so the flow can be tried after the close.
const PAPER_LIMITS: RiskLimits = {
  maxOrderNotional: PAPER_CASH,
  allowedSessions: Object.values(Session),
};

// Fubon tells of one order in a few reports at once (taken, changed, filled), which one read covers.
const BROKER_REPORTS_SETTLE_MS = 500;

// How often the desk asks the broker which exit legs it still watches, so one sale ends the rest
// and the paper account checks the last price of a listing the live stream does not cover.
const EXIT_WATCH_MS = 60_000;

// A live account's orders go only to the regular session, whose books every broker takes alike.
const LIVE_LIMITS: RiskLimits = {
  maxOrderNotional: PAPER_CASH,
  allowedSessions: [Session.Regular],
};

/** Composition root. A live broker is only ever wired here after the user explicitly turns it on. */
export function createServices(config: ConfigFile) {
  const userDataDir = app.getPath("userData");
  const home = app.getPath("home");
  const configDir = dirname(config.file);

  const folders = {
    dataDir: userDataDir,
    configDir,
    workspaces: join(userDataDir, "agent-workspaces"),
  };

  // Before anything opens a file, since a backup the user had restored takes their place here.
  const restored = takeRestore(folders);

  // Each window streams what it follows from here for as long as its page stays open.
  const windowEvents = new MemoryPublisher<WindowEvents>();

  const userData = openUserData(
    join(userDataDir, "user.sqlite"),
    join(import.meta.dirname, "migrations", "user")
  );

  const watchlist = createWatchlist({
    store: userData.watchlist,
    onChange() {
      void windowEvents.publish("watchlist:changed", {});
      void windowEvents.publish("inbox:changed", {});
    },
  });

  // Read once: the desk trades one account for the app's life, and a switch waits for a restart.
  const picked = config.read().trading;
  const tradesFubon = picked.broker === TradingBroker.Fubon;

  const desk = new OrderDesk({
    broker: tradesFubon
      ? createFubonBroker({
          session: () => marketDataSources.fubonSession(),
          account: picked.account,
        })
      : createPaperBroker({
          cash: PAPER_CASH,
          ledger: userData.paperAccount,
          async getLastPrice(instrument) {
            const quote = await marketData.quote(instrument);

            if (!quote) {
              throw new Error(
                `No market data source covers ${symbolLabel(instrument)}`
              );
            }

            return quote.last;
          },
          // The live stream's minute bars, which charts share; past the plan's symbols, the last price is checked instead.
          bars: (instrument, signal) =>
            marketData.liveCandles(instrument, Interval.OneMinute, signal),
          // As Fubon's reports do, so the exit's proposal shows it ended and the account shows the sale.
          onExitSold: () =>
            void desk
              .brokerChanged()
              .catch((error) =>
                diagnostics.recovered(error, "desk.broker-changed")
              ),
        }),
    store: userData.proposals,
    limits: tradesFubon ? LIVE_LIMITS : PAPER_LIMITS,
    tradingDays: (market) => marketDays(market),
    // A quote out of reach leaves the price unknown rather than failing the check.
    lastPrice: (symbol) =>
      marketData.quote(symbol).then(
        (quote) => quote?.last ?? null,
        (error) => {
          diagnostics.recovered(error, "desk.last-price", {
            "solyx.listing": symbolKey(symbol),
          });

          return null;
        }
      ),
    // A list out of reach leaves the limits unknown rather than failing the check.
    priceLimits: (symbol) =>
      fundamentals.priceLimits(symbol).catch((error) => {
        diagnostics.recovered(error, "desk.price-limits", {
          "solyx.listing": symbolKey(symbol),
        });

        return null;
      }),
    locked: () => config.read().trading.locked,
    mandate: () => mandates.current(),
    lockOrders: () => config.set(["trading", "locked"], true),
    maxDailyLoss: () => config.read().trading.maxDailyLoss,
    restored: restored !== null,
    basis: (symbol) => research.desk.basis(symbol),
    onChange() {
      void windowEvents.publish("proposals:changed", {});
      void windowEvents.publish("inbox:changed", {});
      void tray.sync();
    },
  });

  // The desk has dismissed what waited in the backup, so the restore needs nothing more.
  settleRestore(userDataDir);

  const secrets = createSecretStore(
    join(userDataDir, "secrets.json"),
    electronCipher
  );

  const mandates = createMandateStore(secrets);

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

  const marketDataSources = createMarketDataSources({
    config,
    secrets,
    candles: cache.candles,
    fubonLogDir: join(userDataDir, "fubon"),
    openFubonProcess,
    tradesFubon,
  });

  const marketData = createMarketData({
    sources: marketDataSources,
    marketDays: (market) => marketDays(market),
    answers: cache.answers,
    onSourcesChanged: () =>
      void windowEvents.publish("market:sources-changed", {}),
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

  const embeddings = createEmbeddings({
    config,
    secrets,
    diagnostics,
    onChange: () => void windowEvents.publish("embeddings:changed", {}),
  });

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
    () => void windowEvents.publish("memory:changed", {})
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
      void windowEvents.publish("news:changed", symbol);
      void research.watch(symbol);
    },
  });

  // One client, so fundamentals, flows and trading days share FinMind's hourly limit.
  const finMind = createFinMind({
    token: () => secrets.get(Secret.FinMindToken),
    plan: () => config.read().providers.finmind.plan,
  });

  const twExchanges = createTwExchanges();

  const fundamentals = createFundamentals({
    providers: [finMind],
    exchanges: [twExchanges],
    fundReports: [createSitca()],
    answers: cache.answers,
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
      reader: () => decisions.factReader(),
      news: newsData.store,
      embedder: () => embeddings.localEmbedder(),
      diagnostics,
      sessions: () => marketSessions(marketDays),
    },
    () => {
      void windowEvents.publish("research:changed", {});
      void windowEvents.publish("inbox:changed", {});
    }
  );

  // The statistics portal's server leaves its intermediate certificate out, which Node's fetch does not make up for.
  const macro = createMacro({
    calendars: [createStatGovTw({ fetch: chromiumFetch })],
    figures: [createDgbas()],
    answers: cache.answers,
  });

  const calendar = createCalendar({
    fundamentals,
    macro,
    closures: [twExchanges],
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
      }

      void windowEvents.publish("settings:appearance", next);
    },
  });

  /** The palette windows show now, in the scheme the theme or the computer picks. */
  function windowColors() {
    return appearance.colors(
      nativeTheme.shouldUseDarkColors ? ColorScheme.Dark : ColorScheme.Light
    );
  }

  const marketDays = createMarketDays({ tradingDays, diagnostics });
  const scheduleDays = createScheduleDays(marketDays);

  const themes = createThemes({
    store: userData.themes,
    web: () => webSearch.vendor(),
    auditor: () => decisions.claimAuditor(),
    plan: () => config.read().collection[CollectionJob.Themes],
    days: scheduleDays,
    diagnostics,
    onChange: () => void windowEvents.publish("themes:changed", {}),
  });

  // What the main process writes itself is in the language and on the clock the windows show.
  const userLocale = () =>
    resolveLocale(appearance.read().language, app.getLocale());

  const userTimeZone = () =>
    resolveTimeZone(appearance.read().timeZone, Temporal.Now.timeZoneId());

  const deviceId = installationId(join(userDataDir, "installation-id"));

  const agent = createAgentService({
    config,
    secrets,
    tracer: telemetry.tracer,
    getDeviceId: deviceId,
    openExternal,
    showSignInCode: (code) =>
      void windowEvents.publish("settings:sign-in-code", code),
    modelsFile: join(userDataDir, "agent-models.json"),
    onModelsListed: () => void windowEvents.publish("settings:changed", {}),
    skillFolders,
    instructionsFile,
    mcp,
    workspaces: folders.workspaces,
    async judgeCommand(input, signal) {
      const judgement = await (
        await decisions.commandJudge()
      )?.judge(input, { signal });

      return judgement && omit(judgement, ["model"]);
    },
    conversations: openAgentStore(join(userDataDir, "agent.sqlite")),
    diagnostics,
    marketData,
    watchlist,
    news,
    headlines: (symbols, since, limit) => news.headlines(symbols, since, limit),
    tradingDays,
    marketDays,
    calendar,
    web: () => webSearch.vendor(),
    desk,
    memory: memories.store,
    localEmbedder: () => embeddings.localEmbedder(),
    research: research.desk,
    themes: themes.desk,
    searchTheme: (id) => themes.check(id),
    // The tasks run through the agent, so they are built after it and reached only as a tool is called.
    tasks: {
      list: () => schedules.list(),
      save: (id, draft) => schedules.save(id, draft),
      run: (id) => schedules.runNow(id),
      clock: () => ({ timeZone: userTimeZone(), locale: userLocale() }),
    },
    fundamentals,
    flows,
    macro,
    sectors: () => marketData.sectors(),
    rotations: () => marketData.rotations(),
    quote: (symbol) => marketData.quote(symbol),
    candlesSince: (symbol, interval, since) =>
      marketData.candlesSince(symbol, interval, since),
    setup: {
      appearance,
      marketData,
      webSearch,
      decisions,
      embeddings,
      schedules: userData.schedules,
      themes: userData.themes,
      // Built after the agent, whose conversations it counts, and read only as a tool is called.
      storage: { usage: () => storage.usage() },
      mandate: () => mandates.current(),
      version: app.getVersion(),
      home,
    },
    onActivity() {
      void windowEvents.publish("inbox:changed", {});
      void tray.sync();
    },
    onUpdate: (update) => void windowEvents.publish("agent:update", update),
    onStoreFailed: () => void windowEvents.publish("agent:store-failed", {}),
  });

  const storage = createStorageApi({
    cache,
    agent,
    memories,
    news: newsData,
    research,
    watchlist,
  });

  /** Quits the app and starts it again; quitting closes what is open first, as any quit does. */
  function restart() {
    app.relaunch();
    app.quit();
  }

  const backups = createBackups({
    config,
    secrets,
    // `vp pack` builds the backups' worker next to the main bundle.
    engine: createBackupThreads(
      pathToFileURL(join(import.meta.dirname, "../worker/backup.mjs"))
    ),
    folders,
    // vp pack copies the migrations next to the bundle; see vite.config.ts.
    migrations: join(import.meta.dirname, "migrations"),
    app: kebabCase(app.getName()),
    version: app.getVersion(),
    installation: deviceId,
    restored,
    restart,
    timeZone: userTimeZone,
    diagnostics,
    onChange: () => void windowEvents.publish("backup:changed", {}),
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

    return uniqBy([...held, ...watchlist.list()], symbolKey);
  }

  const inbox = createInbox({
    desk,
    approvals,
    followed: followedListings,
    research: research.desk,
  });

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
    onChange() {
      void windowEvents.publish("updates:changed", {});
      void tray.sync();
    },
  });

  const schedules = createSchedules({
    store: userData.schedules,
    agent,
    days: scheduleDays,
    async changes(since, scope) {
      // The account is read only for a scope that names no listings of its own.
      const listings = watchesListings(scope)
        ? (scope.listings ?? (await followedListings()))
        : [];

      return changesSince(
        since,
        Date.now(),
        {
          reports: listings.flatMap((symbol) => {
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
        },
        scope
      );
    },
    diagnostics,
    onChange() {
      void windowEvents.publish("schedules:changed", {});
      void tray.sync();
    },
  });

  const showWindow = () => showMainWindow(windowColors);

  const workspace = createWorkspace({
    showWindow,
    onDestination: () => void windowEvents.publish("workspace:changed", {}),
  });

  /** The conversations with a call waiting for the user to allow it. */
  async function approvals(): Promise<Approval[]> {
    const asked = new Set(agent.waiting());

    // Conversations are read only for the titles of those that ask.
    const sessions = asked.size > 0 ? await agent.sessions() : [];

    return sessions
      .filter((session) => asked.has(session.id))
      .map(({ id, title }) => ({ sessionId: id, title }));
  }

  /** What the tray's menu lists of the desk, the agent, the scheduled tasks and updates. */
  async function trayState(): Promise<TrayState> {
    const [asked, tasks] = await Promise.all([approvals(), schedules.list()]);

    return {
      mode: desk.mode,
      proposals: desk
        .list()
        .filter(
          (proposal) => proposal.status === ProposalStatus.AwaitingConfirmation
        ).length,
      approvals: asked,
      tasks: tasks
        .filter((task) => task.enabled || task.running)
        .map(({ name, running, nextRunAt, lastRun }) => ({
          name,
          running,
          nextRunAt,
          sessionId: lastRun?.sessionId ?? null,
        })),
      update: updates.state(),
    };
  }

  const tray = createTray({
    settings: () => config.read().tray,
    locale: userLocale,
    timeZone: userTimeZone,
    state: trayState,
    open: (destination) => workspace.open(destination),
    installUpdate: () => updates.install(),
    shell: createTrayShell(showWindow),
    diagnostics,
  });

  const scheduler = createScheduler({ telemetry });

  scheduler.register("News collection", newsCollector.work);
  scheduler.register(
    "News retention",
    createNewsRetention({ news: newsData, config, diagnostics })
  );
  scheduler.register("Update check", updates);
  scheduler.register("Scheduled tasks", schedules.work);
  scheduler.register("Change watch", schedules.changeWork);
  scheduler.register("Theme watch", themes.work);
  scheduler.register("Exchange clock", research.work);
  scheduler.register("Backup", backups.work);
  scheduler.register("Exit watch", {
    everyMs: EXIT_WATCH_MS,
    async run() {
      // Prices move only in a regular session, so outside one nothing can reach an exit.
      const sessions = await marketSessions(marketDays);

      if (Object.values(sessions).includes(Session.Regular)) {
        await desk.reconcileExits();
      }
    },
  });

  nativeTheme.themeSource = appearance.read().theme;

  config.onChange(() => void windowEvents.publish("settings:changed", {}));
  // A collection's plan lives in the config file, so whoever shows the plans hears of every edit.
  config.onChange(() => void windowEvents.publish("schedules:changed", {}));
  secrets.onChange(() => void windowEvents.publish("settings:changed", {}));
  // Where backups go is settings and secrets both.
  config.onChange(() => void windowEvents.publish("backup:changed", {}));
  // Ollama's model and address are in the config file, and a key for a host of the user's own a secret.
  config.onChange(() => void windowEvents.publish("embeddings:changed", {}));
  secrets.onChange(() => void windowEvents.publish("embeddings:changed", {}));
  secrets.onChange(() => void windowEvents.publish("backup:changed", {}));
  // Its switches and its menu's language and clock all live in the config file.
  config.onChange(() => void tray.sync());
  config.watch();

  // A proposal whose sending was cut off or went unanswered may have reached the broker.
  desk
    .reconcile()
    .catch((error) => diagnostics.recovered(error, "desk.reconcile"));

  if (tradesFubon) {
    marketDataSources.onFubonChange(
      debounce(
        () =>
          void desk
            .brokerChanged()
            .catch((error) =>
              diagnostics.recovered(error, "desk.broker-changed")
            ),
        BROKER_REPORTS_SETTLE_MS
      )
    );
  }

  return {
    desk,
    tradingBroker: desk.brokerId,
    mandates,
    marketDays,
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
    watchlist,
    memories,
    research,
    calendar,
    macro,
    flows,
    fundamentals,
    agent,
    backups,
    /** The backup the app started on, when it was restored as it started. */
    restored,
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
    storage,
    scheduler,
    tray,
    workspace,
    inbox,
    windowEvents,
    settingsShell,

    restart,
  };
}

export type Services = ReturnType<typeof createServices>;
