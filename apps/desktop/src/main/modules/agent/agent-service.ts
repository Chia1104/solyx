import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Tracer } from "@opentelemetry/api";
import { BrowserWindow } from "electron";
import { omit, sum } from "es-toolkit";

import { createAnalysis } from "@solyx/agent/analysis";
import { createFlowTools } from "@solyx/agent/flows";
import { createHistory } from "@solyx/agent/history";
import { createMagi } from "@solyx/agent/magi";
import type { MagiPort } from "@solyx/agent/magi";
import { mcpScriptExtension } from "@solyx/agent/mcp-script";
import { createMemory } from "@solyx/agent/memory";
import { formatContext } from "@solyx/agent/prompt";
import type { AgentModelPick } from "@solyx/agent/providers";
import { createResearch } from "@solyx/agent/research";
import { createAgentRuntime } from "@solyx/agent/runtime";
import { createScriptRunner } from "@solyx/agent/script-runner";
import { createSetupTools } from "@solyx/agent/setup";
import { createShell } from "@solyx/agent/shell";
import type { ShellOptions } from "@solyx/agent/shell";
import { loadInstructions, loadSkillCatalog } from "@solyx/agent/skills";
import type { SkillFolders } from "@solyx/agent/skills";
import { createTradingExtension } from "@solyx/agent/tools";
import { createRunTraces } from "@solyx/agent/traces";
import { createWebTools } from "@solyx/agent/web";
import { ApprovalMode } from "@solyx/agent/wire";
import type {
  AgentSession,
  AgentSessionSetup,
  AgentWireEvent,
} from "@solyx/agent/wire";
import { BrokerMode } from "@solyx/core/broker";
import { DecisionMode } from "@solyx/core/council";
import type { Embedder } from "@solyx/core/embedding";
import type { Flows } from "@solyx/core/flows";
import type { Fundamentals } from "@solyx/core/fundamentals";
import type { SymbolRef } from "@solyx/core/market";
import type { MarketData } from "@solyx/core/market-data";
import type { MemoryStore } from "@solyx/core/memory";
import type { NewsDesk } from "@solyx/core/news";
import type { ProposingDesk } from "@solyx/core/order-desk";
import type { ResearchDesk } from "@solyx/core/research";
import { ScheduleApproval } from "@solyx/core/schedule";
import type { ScheduledTask } from "@solyx/core/schedule";
import type { WebReader, WebSearch } from "@solyx/core/web-search";
import type { AgentStore } from "@solyx/db/agent";
import { isErrnoError } from "@solyx/utils/error";

import { agentEvents } from "#shared/ipc/agent.ts";
import type { AgentFocus, AgentUpdate } from "#shared/ipc/agent.ts";
import type { Locale, TimeZone } from "#shared/ipc/settings.ts";
import type { ConversationsUsage } from "#shared/ipc/storage.ts";

import type { Calendar } from "../calendar/calendar.ts";
import type { TradingCalendar } from "../market/trading-calendar.ts";

import { createAgentModels } from "./agent-models.ts";
import type { AgentModelsOptions } from "./agent-models.ts";
import { createAgentSetup } from "./agent-setup.ts";
import type { AgentSetupSources } from "./agent-setup.ts";
import type { McpServers } from "./mcp-servers.ts";
import { messageContext } from "./message-context.ts";
import { loginShellPath } from "./shell-path.ts";

interface AgentServiceOptions extends AgentModelsOptions {
  /** Each run is a trace of its model requests and tool calls. */
  tracer: Tracer;
  skillFolders: SkillFolders;
  /** AGENTS.md beside the config file. */
  instructionsFile: string;
  /** The folder holding one folder per conversation, where its shell commands run. */
  workspaces: string;
  /** What the decisions model makes of a shell command, for conversations set to auto. */
  judgeCommand: ShellOptions["judge"];
  /** Where conversations persist, opening as the app starts. */
  conversations: Promise<AgentStore>;
  marketData: MarketData;
  watchlist: () => SymbolRef[];
  news: NewsDesk;
  tradingDays: TradingCalendar;
  calendar: Calendar;
  /** The web search vendor the user set up; `undefined` until its key is saved. */
  web: () => Promise<(WebSearch & WebReader) | undefined>;
  desk: ProposingDesk;
  mcp: McpServers;
  memory: MemoryStore;
  /** Embeds memories to search them and tell one said again; only a model on this computer. */
  localEmbedder: () => Embedder | undefined;
  research: ResearchDesk;
  fundamentals: Fundamentals;
  flows: Flows;
  /** What the agent reads of the rest of the app's settings. */
  setup: AgentSetupSources;
}

// `vp pack` ships QuickJS beside the main bundle and builds the scripts' worker next to it.
const SCRIPT_FILES = {
  wasm: join(import.meta.dirname, "quickjs.wasm"),
  worker: pathToFileURL(join(import.meta.dirname, "../worker/script.mjs")),
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

  // Every window shows the same conversations, so every window hears every run.
  const onEvent = (sessionId: string, event: AgentWireEvent) => {
    const update: AgentUpdate = { sessionId, event };

    traces.event(sessionId, event);

    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(agentEvents.onEvent, update);
    }
  };

  // Unsandboxed commands could reach the app's own files, so the shell stays off beside real money.
  const shellOn = () =>
    options.config.read().agent.shell && options.desk.mode === BrokerMode.Paper;

  const workspace = (id: string) => join(options.workspaces, id);

  const shell = createShell({
    workspace,
    path: loginShellPath(),
    judge: options.judgeCommand,
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
    watchlist: options.watchlist,
    news: options.news,
    tradingDays: options.tradingDays,
    calendar: (symbols, days) => options.calendar.upcoming(symbols, days),
    desk: options.desk,
    magi,
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
    watchlist: options.watchlist,
    desk: options.desk,
    scripts,
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
  });

  const flows = createFlowTools({ flows: options.flows });

  const history = createHistory({
    research: options.research,
    news: options.news,
    desk: options.desk,
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
    async tools(guard) {
      const mcp = await options.mcp.extensions(guard);
      const webOn = (await options.web()) !== undefined;

      // MCP tools wait until the agent finds them, so only the servers' names ride every request.
      return {
        offered: [
          trading,
          analysis,
          research,
          flows,
          history,
          createSetupTools({ setup, guard }),
          ...(shellOn() ? [shell.extension(guard)] : []),
          ...(webOn ? [web.extension(guard)] : []),
          ...(options.config.read().agent.memory
            ? [memory.extension(guard)]
            : []),
          mcp.search,
          mcpScriptExtension(mcp.catalog, scripts),
          traces.extension,
        ],
        deferred: [mcp.tools],
      };
    },
    env: shell.env,
    onEvent,
  });

  /** Erases the conversation, then the folder its shell commands worked in. */
  async function deleteSession(id: string) {
    await runtime.delete(id);
    await rm(workspace(id), { recursive: true, force: true });
  }

  /** Sends a message with the app's context for its moment; `scheduled` names the task that sent it in the user's place. */
  async function send(
    id: string,
    text: string,
    {
      focus,
      locale,
      timeZone,
      scheduled,
    }: {
      focus: AgentFocus | null;
      locale: string;
      timeZone: string;
      scheduled?: string;
    }
  ) {
    const now = new Date();

    const { mentions, skill } = await messageContext(text, {
      focus,
      watchlist: options.watchlist,
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

    return runtime.send(id, {
      text,
      context: formatContext({
        now,
        brokerMode: options.desk.mode,
        focus: focus ?? undefined,
        mentions,
        skill,
        locale,
        timeZone,
        decisionMode: decisionMode(),
        scheduled,
      }),
    });
  }

  return {
    models,
    skills,
    instructions,

    resume: () => runtime.resume(),

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

    compact: (id: string, instructions: string | null) =>
      runtime.compact(id, instructions ?? undefined),

    approve: (id: string, toolCallId: string, approved: boolean) =>
      runtime.approve(id, toolCallId, approved),

    setApprovalMode: (id: string, mode: ApprovalMode) =>
      runtime.setApprovalMode(id, mode),

    setModel: (id: string, pick: AgentModelPick) => runtime.setModel(id, pick),

    /** Closes the conversations, then the scripts and MCP servers their runs used, as the app quits. */
    async close() {
      await runtime.close();
      await scripts.close();
      await options.mcp.close();
    },

    send: (
      id: string,
      text: string,
      focus: AgentFocus | null,
      locale: Locale,
      timeZone: TimeZone
    ) => send(id, text, { focus, locale, timeZone }),

    /** Whether a run is going in the conversation; one since deleted has none. */
    busy: (id: string) => runtime.busy(id),

    /**
     * Starts a conversation of its own for a scheduled task and sends it the task's prompt, on the
     * default model and with no listing on screen, since nobody is at the app. A prompt that could
     * not be sent leaves no conversation behind.
     */
    async runScheduled({
      id,
      name,
      prompt,
      approval,
      locale,
      timeZone,
    }: Pick<
      ScheduledTask,
      "id" | "name" | "prompt" | "approval" | "locale" | "timeZone"
    >): Promise<AgentSession> {
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
          focus: null,
          locale,
          timeZone,
          scheduled: name,
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
