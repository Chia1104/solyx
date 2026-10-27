import { lstat, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Tracer } from "@opentelemetry/api";
import { omit, sum } from "es-toolkit";

import { createAnalysis } from "@solyx/agent/analysis";
import type { AnalysisPorts } from "@solyx/agent/analysis";
import { createFlowTools } from "@solyx/agent/flows";
import { createHeadlineTools } from "@solyx/agent/headlines";
import type { HeadlineToolsOptions } from "@solyx/agent/headlines";
import { createHistory } from "@solyx/agent/history";
import { createMacroTools } from "@solyx/agent/macro";
import { createMagi } from "@solyx/agent/magi";
import type { MagiPort } from "@solyx/agent/magi";
import { mcpScriptExtension } from "@solyx/agent/mcp-script";
import { createMemory } from "@solyx/agent/memory";
import { AppPlace, formatContext } from "@solyx/agent/prompt";
import type { AgentModelPick } from "@solyx/agent/providers";
import { createQuoteTools } from "@solyx/agent/quotes";
import type { QuoteToolsOptions } from "@solyx/agent/quotes";
import { createResearch } from "@solyx/agent/research";
import { createAgentRuntime } from "@solyx/agent/runtime";
import type { Sandbox } from "@solyx/agent/sandbox";
import { createScriptRunner } from "@solyx/agent/script-runner";
import { createSectorTools } from "@solyx/agent/sectors";
import type { SectorToolsOptions } from "@solyx/agent/sectors";
import { createSetupTools } from "@solyx/agent/setup";
import { createShell } from "@solyx/agent/shell";
import type { ShellOptions } from "@solyx/agent/shell";
import { loadInstructions, loadSkillCatalog } from "@solyx/agent/skills";
import type { SkillFolders } from "@solyx/agent/skills";
import { createStrategyTools } from "@solyx/agent/strategies";
import type { StrategiesPort } from "@solyx/agent/strategies";
import { createTaskTools } from "@solyx/agent/tasks";
import type { TaskPort } from "@solyx/agent/tasks";
import { createThemeTools } from "@solyx/agent/themes";
import { createTradingExtension } from "@solyx/agent/tools";
import { createRunTraces } from "@solyx/agent/traces";
import { createWatchlistTools } from "@solyx/agent/watchlist";
import type { WatchlistPort } from "@solyx/agent/watchlist";
import { createWebTools } from "@solyx/agent/web";
import { ApprovalMode } from "@solyx/agent/wire";
import type {
  AgentSession,
  AgentSessionSetup,
  AgentWireEvent,
} from "@solyx/agent/wire";
import type { AgentScreen, AgentUpdate } from "@solyx/api/agent";
import { OverviewTab, overviewLink } from "@solyx/api/overview-tab";
import type { Locale, TimeZone } from "@solyx/api/settings";
import type { ConversationsUsage } from "@solyx/api/storage";
import { strategiesLink } from "@solyx/api/strategies";
import { symbolLink } from "@solyx/api/symbol-link";
import type { BacktestKernel } from "@solyx/core/backtest";
import { BrokerMode } from "@solyx/core/broker";
import type { Change } from "@solyx/core/changes";
import { DecisionMode } from "@solyx/core/council";
import type { Embedder } from "@solyx/core/embedding";
import type { Flows } from "@solyx/core/flows";
import type { Fundamentals } from "@solyx/core/fundamentals";
import type { MarketData } from "@solyx/core/market-data";
import type { MemoryStore } from "@solyx/core/memory";
import type { NewsDesk } from "@solyx/core/news";
import type { ProposingDesk } from "@solyx/core/order-desk";
import type { ResearchDesk } from "@solyx/core/research";
import { ScheduleApproval } from "@solyx/core/schedule";
import type { ScheduledTask } from "@solyx/core/schedule";
import type { ThemeDesk } from "@solyx/core/theme";
import type { WebReader, WebSearch } from "@solyx/core/web-search";
import type { AgentStore } from "@solyx/db/agent";
import { isErrnoError } from "@solyx/utils/error";

import type { Calendar } from "../calendar/calendar.ts";
import type { Macro } from "../macro/macro.ts";
import { marketSessions } from "../market/trading-calendar.ts";
import type {
  MarketDays,
  TradingCalendar,
} from "../market/trading-calendar.ts";
import type { Diagnostics } from "../telemetry/diagnostics.ts";

import { createAgentModels } from "./agent-models.ts";
import type { AgentModelsOptions } from "./agent-models.ts";
import { createAgentSetup } from "./agent-setup.ts";
import type { AgentSetupSources } from "./agent-setup.ts";
import { keepAttachments } from "./attachments.ts";
import { createImageThreads } from "./image-threads.ts";
import type { McpServers } from "./mcp-servers.ts";
import { messageContext, screenContext } from "./message-context.ts";
import { loginShellPath } from "./shell-path.ts";
import { createWaitingCalls } from "./waiting-calls.ts";

interface AgentServiceOptions extends AgentModelsOptions {
  /** Each run is a trace of its model requests and tool calls. */
  tracer: Tracer;
  skillFolders: SkillFolders;
  /** AGENTS.md beside the config file. */
  instructionsFile: string;
  /** The folder holding one folder per conversation, where its shell commands run. */
  workspaces: string;
  /** The app's one sandbox, which shell commands run in while the user keeps it on; none on Windows. */
  sandbox: Sandbox | undefined;
  /** What the decisions model makes of a shell command, for conversations set to auto. */
  judgeCommand: ShellOptions["judge"];
  /** The user's strategies, which the agent writes, backtests and asks to run. */
  strategies: StrategiesPort;
  /** Where conversations persist, opening as the app starts. */
  conversations: Promise<AgentStore>;
  diagnostics: Pick<Diagnostics, "report">;
  marketData: MarketData;
  watchlist: WatchlistPort;
  news: NewsDesk;
  /** The heaviest headlines about some listings, as the overview ranks them from the news kept. */
  headlines: HeadlineToolsOptions["headlines"];
  tradingDays: TradingCalendar;
  /** The days each market trades for telling its session, which answers even while they cannot be read. */
  marketDays: MarketDays;
  calendar: Calendar;
  /** The web search vendor the user set up; `undefined` until its key is saved. */
  web: () => Promise<(WebSearch & WebReader) | undefined>;
  desk: ProposingDesk;
  mcp: McpServers;
  memory: MemoryStore;
  /** Embeds memories to search them and tell one said again; only a model on this computer. */
  localEmbedder: () => Embedder | undefined;
  research: ResearchDesk;
  themes: ThemeDesk;
  /** Searches a theme now, as the themes tab's own button does. */
  searchTheme: (id: string) => Promise<void>;
  /** The scheduled tasks, which run through this service and so are built after it. */
  tasks: TaskPort;
  fundamentals: Fundamentals;
  flows: Flows;
  /** Each market's indicators' figures, for the agent's own read of them. */
  macro: Pick<Macro, "series">;
  /** Taiwan's sector indices, as the overview's map reads them. */
  sectors: SectorToolsOptions["sectors"];
  /** Those indices' rotation against the TAIEX, as the overview's chart reads it. */
  rotations: SectorToolsOptions["rotations"];
  /** Listings' rotation against their market's index, as the overview's chart reads it. */
  listingRotations: SectorToolsOptions["listingRotations"];
  /** A listing's newest session, as the overview's moves read it. */
  quote: QuoteToolsOptions["quote"];
  /** A listing's bars from a day on, for a script that needs more than the lookback. */
  candlesSince: AnalysisPorts["candlesSince"];
  /** Runs the backtests a script declares. */
  kernel: BacktestKernel;
  /** What the agent reads of the rest of the app's settings. */
  setup: AgentSetupSources;
  /** A run started or ended, or one of its calls began or stopped waiting for the user. */
  onActivity: () => void;
  /** Every event of every conversation's runs, which every window shows. */
  onUpdate: (update: AgentUpdate) => void;
  /** The conversations' store failed, which `storeFailed` tells from then on. */
  onStoreFailed: () => void;
}

// `vp pack` ships QuickJS beside the main bundle and builds the scripts' worker next to it.
const SCRIPT_FILES = {
  wasm: join(import.meta.dirname, "quickjs.wasm"),
  worker: pathToFileURL(join(import.meta.dirname, "../worker/script.mjs")),
};

// The same for Photon, which scales the images a message carries.
const IMAGE_FILES = {
  wasm: join(import.meta.dirname, "photon_rs_bg.wasm"),
  worker: pathToFileURL(join(import.meta.dirname, "../worker/images.mjs")),
};

// A scheduled task names no way to let every call run, so no run nobody watches is set to bypass.
const UNATTENDED_MODE: Record<ScheduleApproval, ApprovalMode> = {
  [ScheduleApproval.Ask]: ApprovalMode.Ask,
  [ScheduleApproval.Auto]: ApprovalMode.Auto,
};

/** What a file takes up on disk, or a folder with everything under it; nothing once it is gone. */
async function diskBytes(path: string): Promise<number> {
  try {
    const stats = await lstat(path);

    if (!stats.isDirectory()) return stats.size;

    const entries = await readdir(path);

    return sum(
      await Promise.all(entries.map((entry) => diskBytes(join(path, entry))))
    );
  } catch (error) {
    if (isErrnoError(error, "ENOENT")) return 0;

    throw error;
  }
}

/** The agent as the app wires it: the user's model and key, the trading tools and the desk. */
export function createAgentService(options: AgentServiceOptions) {
  const models = createAgentModels(options);

  // Read for every request and every settings view, so edits apply without a restart.
  const skills = () =>
    loadSkillCatalog(
      options.skillFolders,
      new Set(options.config.read().agent.sharedSkills)
    );

  const instructions = () => loadInstructions(options.instructionsFile);

  const traces = createRunTraces(options.tracer);

  const waitingCalls = createWaitingCalls();

  // Set for good: only the app starting again opens the store anew.
  let storeFailed = false;

  // Every window shows the same conversations, so every window hears every run.
  const onEvent = (sessionId: string, event: AgentWireEvent) => {
    const update: AgentUpdate = { sessionId, event };

    traces.event(sessionId, event);

    options.onUpdate(update);

    if (waitingCalls.follow(sessionId, event)) options.onActivity();
  };

  // A command still reaches what the sandbox leaves it, and on Windows, where it runs unsandboxed,
  // the app's own files, so the shell stays off beside real money.
  const shellOn = () =>
    options.config.read().agent.shell && options.desk.mode === BrokerMode.Paper;

  // A conversation's id names its folder, so one that would reach past the folders names none.
  const workspace = (id: string) => {
    if (id !== basename(id) || id === "." || id === "..") {
      throw new Error(`Conversation ${id} not found`);
    }

    return join(options.workspaces, id);
  };

  const shell = createShell({
    workspace,
    path: loginShellPath(),
    judge: options.judgeCommand,
    sandbox: {
      box: options.sandbox,
      enabled: () => options.config.read().agent.shellSandbox,
      // A command runs the scripts of the skills offered, which `read_skill` names.
      readable: async () =>
        (await skills()).skills.flatMap((skill) =>
          skill.offered && skill.folder !== undefined ? [skill.folder] : []
        ),
    },
  });

  const decisionMode = () => options.config.read().agent.decisionMode;

  // A unit answers on its own model where the user picked one, else on the conversation's.
  const magi: MagiPort = async (conversationId) => {
    if (decisionMode() !== DecisionMode.Magi) return undefined;

    return createMagi({
      models: models.models,
      async model(unit) {
        const session = (await runtime.sessions()).find(
          (each) => each.id === String(conversationId)
        );

        const { model } = await models.choice({
          model:
            options.config.read().agent.magi[unit] ?? session?.model ?? null,
          thinking: session?.thinking ?? null,
        });

        return model;
      },
    });
  };

  const trading = createTradingExtension({
    marketData: options.marketData,
    watchlist: options.watchlist.list,
    news: options.news,
    tradingDays: options.tradingDays,
    calendar: (symbols, days) => options.calendar.upcoming(symbols, days),
    figures: options.macro.series,
    desk: options.desk,
    magi,
    links: {
      listing: symbolLink,
      overview: {
        [AppPlace.Moves]: overviewLink(OverviewTab.Today),
        [AppPlace.Headlines]: overviewLink(OverviewTab.News),
        [AppPlace.Calendar]: overviewLink(OverviewTab.Calendar),
        [AppPlace.Market]: overviewLink(OverviewTab.Market),
      },
      strategy: strategiesLink,
    },
    // A skill's folder is told only while the shell that could run its scripts is on.
    skills: async () =>
      (await skills()).skills
        .filter((skill) => skill.offered)
        .map((skill) => (shellOn() ? skill : omit(skill, ["folder"]))),
    instructions,
  });

  const scripts = createScriptRunner(SCRIPT_FILES);

  const analysis = createAnalysis({
    marketData: options.marketData,
    watchlist: options.watchlist.list,
    desk: options.desk,
    candlesSince: options.candlesSince,
    quote: options.quote,
    sectors: options.sectors,
    flows: options.flows,
    fundamentals: options.fundamentals,
    strategies: options.strategies,
    scripts,
    kernel: options.kernel,
  });

  const strategyTools = createStrategyTools(options.strategies);

  const quotes = createQuoteTools({
    quote: options.quote,
    marketData: options.marketData,
    watchlist: options.watchlist.list,
    desk: options.desk,
  });

  const web = createWebTools({ vendor: options.web });

  const memory = createMemory({
    store: options.memory,
    embedder: options.localEmbedder,
  });

  const research = createResearch({
    desk: options.research,
    fundamentals: options.fundamentals,
    marketData: options.marketData,
    magi,
    read: (conversationId) => runtime.read(String(conversationId)),
  });

  const flows = createFlowTools({ flows: options.flows });

  const macro = createMacroTools({ series: options.macro.series });

  const sectors = createSectorTools({
    sectors: options.sectors,
    rotations: options.rotations,
    listingRotations: options.listingRotations,
    movers: (sector) => options.fundamentals.sectorMovers(sector),
    marketData: options.marketData,
  });

  const themes = createThemeTools({
    desk: options.themes,
    search: options.searchTheme,
  });

  const tasks = createTaskTools({
    tasks: options.tasks,
    conversations: {
      sessions: () => runtime.sessions(),
      transcript: (id) => runtime.transcript(id),
    },
    themes: options.themes,
  });

  const watched = createWatchlistTools({
    watchlist: options.watchlist,
    marketData: options.marketData,
  });

  const history = createHistory({
    research: options.research,
    news: options.news,
    desk: options.desk,
  });

  const headlines = createHeadlineTools({
    headlines: options.headlines,
    watchlist: options.watchlist.list,
    desk: options.desk,
    tradingDays: options.tradingDays,
  });

  const setup = createAgentSetup({
    ...options.setup,
    config: options.config,
    secrets: options.secrets,
    models,
    mcp: options.mcp,
    skills,
    instructions,
    memory: options.memory,
    shellOn,
    files: {
      config: options.config.file,
      skills: options.skillFolders.solyx,
      instructions: options.instructionsFile,
    },
  });

  const runtime = createAgentRuntime({
    store: options.conversations,
    models: models.models,
    model: (pick) => models.choice(pick),
    async tools({ guard, unasked }) {
      const mcp = await options.mcp.extensions({ guard, unasked });
      const webOn = (await options.web()) !== undefined;

      const strategiesOn =
        (await options.strategies.catalog()).strategies.length > 0;

      // MCP tools wait until the agent finds them, so only the servers' names ride every request.
      return {
        offered: [
          trading,
          analysis,
          quotes,
          research,
          flows,
          macro,
          sectors,
          history,
          headlines,
          themes.extension(guard),
          tasks.extension(guard),
          watched.extension(guard),
          createSetupTools({ setup, guard }),
          strategyTools.extension(guard, strategiesOn),
          ...(shellOn() ? [shell.extension(guard)] : []),
          ...(webOn ? [web.extension(guard)] : []),
          ...(options.config.read().agent.memory
            ? [memory.extension(guard)]
            : []),
          mcp.search,
          mcpScriptExtension(mcp, scripts),
          traces.extension,
        ],
        deferred: [mcp.tools],
      };
    },
    env: shell.env,
    images: createImageThreads(IMAGE_FILES),
    onEvent,
    onStoreFailure(cause) {
      storeFailed = true;
      options.diagnostics.report(cause, "agent.store");

      options.onStoreFailed();
    },
    onReport(cause, info) {
      // The Harness fails only as its store does, which `onStoreFailure` reports.
      if (info.type === "session_failed") return;

      const about = Object.entries({
        report: info.type,
        task: "task" in info ? info.task?.kind : undefined,
        extension: "extension" in info ? info.extension : undefined,
        callback: info.type === "host_error" ? info.callback : undefined,
      }).filter((entry): entry is [string, string] => entry[1] !== undefined);

      options.diagnostics.report(
        cause,
        "agent.durable",
        Object.fromEntries(about)
      );
    },
  });

  /** Erases the conversation, then the folder its shell commands worked in. */
  async function deleteSession(id: string) {
    await runtime.delete(id);
    await rm(workspace(id), { recursive: true, force: true });
    waitingCalls.forget(id);
    options.onActivity();
  }

  /** Sends a message with the app's context for its moment; `scheduled` names the task that sent it in the user's place. */
  async function send(
    id: string,
    text: string,
    {
      screen,
      locale,
      timeZone,
      scheduled,
      changes,
      asksEveryCall,
      attachments = [],
    }: {
      /** What the window showed as the message was written; `null` for one nobody was at the app for. */
      screen: AgentScreen | null;
      locale: string;
      timeZone: string;
      scheduled?: string;
      /** What the app saw change, for a task that ran because of it. */
      changes?: readonly Change[];
      /** Whether its run asks before every call that can ask, as a paired device's message does. */
      asksEveryCall: boolean;
      /** The files the user attached, which only a message they wrote carries. */
      attachments?: readonly File[];
    }
  ) {
    const now = new Date();
    const shown = screenContext(screen, now);

    const kept = await keepAttachments(
      workspace(id),
      attachments,
      now.getTime()
    );

    const { mentions, skill } = await messageContext(text, {
      focus: shown.focus ?? null,
      watchlist: options.watchlist.list,
      holdings: async () =>
        (await options.desk.account()).positions.map(
          (position) => position.instrument
        ),
      name: async (symbol) => (await options.marketData.listing(symbol))?.name,
      commands: async () =>
        (await skills()).skills
          .filter((each) => each.offered && each.userInvocable)
          .map((each) => each.name),
    });

    try {
      await runtime.send(id, {
        text,
        context: formatContext({
          now,
          sessions: await marketSessions(options.marketDays, now),
          brokerMode: options.desk.mode,
          ...shown,
          mentions,
          skill,
          locale,
          timeZone,
          decisionMode: decisionMode(),
          scheduled,
          changes,
        }),
        asksEveryCall,
        attachments: kept.attachments,
      });
    } catch (error) {
      await kept.remove();

      throw error;
    }
  }

  return {
    models,
    skills,
    instructions,

    /**
     * Carries on the runs the app's exit cut off, once the models a server the user runs listed
     * last are back, and has that server list them again meanwhile.
     */
    async resume() {
      await models.restoreServerModels();
      void models.listServerModels();
      await runtime.resume();
    },

    sessions: () => runtime.sessions(),

    createSession: (setup: AgentSessionSetup) => runtime.create(setup),

    deleteSession,

    /** How many conversations there are, and what they and their folders take up on disk. */
    async sessionsUsage(): Promise<ConversationsUsage> {
      const [store, sessions, folders] = await Promise.all([
        options.conversations,
        runtime.sessions(),
        diskBytes(options.workspaces),
      ]);

      return { conversations: sessions.length, bytes: store.bytes() + folders };
    },

    /** Erases every conversation and its folder, then gives the space back to the disk. */
    async deleteAllSessions() {
      for (const session of await runtime.sessions()) {
        await deleteSession(session.id);
      }

      await (await options.conversations).compact();
    },

    transcript: (id: string) => runtime.transcript(id),

    abort: (id: string) => runtime.abort(id),

    retry: (id: string) => runtime.retry(id),

    compact: (id: string, instructions: string | null) =>
      runtime.compact(id, instructions ?? undefined),

    approve: (id: string, toolCallId: string, approved: boolean) =>
      runtime.approve(id, toolCallId, approved),

    setApprovalMode: (id: string, mode: ApprovalMode) =>
      runtime.setApprovalMode(id, mode),

    setModel: (id: string, pick: AgentModelPick) => runtime.setModel(id, pick),

    /** Whether the store failed, so no conversation is read or written until the app restarts. */
    storeFailed: () => storeFailed,

    /** Closes the conversations, then the scripts and MCP servers their runs used, as the app quits. */
    async close() {
      await runtime.close();
      await scripts.close();
      await options.mcp.close();
    },

    send: (
      id: string,
      text: string,
      attachments: readonly File[],
      screen: AgentScreen | null,
      locale: Locale,
      timeZone: TimeZone,
      asksEveryCall: boolean
    ) =>
      send(id, text, {
        screen,
        locale,
        timeZone,
        asksEveryCall,
        attachments,
      }),

    /** Whether a run is going in the conversation; one since deleted has none. */
    busy: (id: string) => runtime.busy(id),

    /** The conversations with a call waiting for the user to allow it. */
    waiting: () => waitingCalls.sessions(),

    /**
     * Starts a conversation of its own for a scheduled task and sends it the task's prompt, on the
     * default model and with no listing on screen, since nobody is at the app, with what the app
     * saw change where that is why it runs. A prompt that could not be sent leaves no conversation
     * behind.
     */
    async runScheduled(
      {
        id,
        name,
        prompt,
        approval,
        locale,
        timeZone,
      }: Pick<
        ScheduledTask,
        "id" | "name" | "prompt" | "approval" | "locale" | "timeZone"
      >,
      changes: readonly Change[] = []
    ): Promise<AgentSession> {
      const session = await runtime.create(
        {
          model: null,
          thinking: null,
          approvalMode: UNATTENDED_MODE[approval],
        },
        { id, name }
      );

      try {
        await send(session.id, prompt, {
          screen: null,
          locale,
          timeZone,
          scheduled: name,
          changes,
          asksEveryCall: false,
        });
      } catch (error) {
        await deleteSession(session.id);

        throw error;
      }

      return session;
    },
  };
}

export type AgentService = ReturnType<typeof createAgentService>;
