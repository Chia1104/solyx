import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { BrowserWindow } from "electron";
import { omit, sum } from "es-toolkit";

import { createAnalysis } from "@solyx/agent/analysis";
import { mcpScriptExtension } from "@solyx/agent/mcp-script";
import { createMemory } from "@solyx/agent/memory";
import { formatContext } from "@solyx/agent/prompt";
import type { AgentModelPick } from "@solyx/agent/providers";
import { createAgentRuntime } from "@solyx/agent/runtime";
import { createScriptRunner } from "@solyx/agent/script-runner";
import { createShell } from "@solyx/agent/shell";
import type { ShellOptions } from "@solyx/agent/shell";
import { loadInstructions, loadSkillCatalog } from "@solyx/agent/skills";
import type { SkillFolders } from "@solyx/agent/skills";
import { createTradingExtension } from "@solyx/agent/tools";
import { createWebTools } from "@solyx/agent/web";
import type { AgentWireEvent, ApprovalMode } from "@solyx/agent/wire";
import { BrokerMode } from "@solyx/core/broker";
import type { SymbolRef } from "@solyx/core/market";
import type { MarketData } from "@solyx/core/market-data";
import type { MemoryStore } from "@solyx/core/memory";
import type { NewsDesk } from "@solyx/core/news";
import type { ProposingDesk } from "@solyx/core/order-desk";
import type { WebReader, WebSearch } from "@solyx/core/web-search";
import type { AgentStore } from "@solyx/db/agent";
import { isErrnoError } from "@solyx/utils/error";

import { agentEvents } from "#shared/ipc/agent.ts";
import type { AgentFocus, AgentUpdate } from "#shared/ipc/agent.ts";
import type { Locale } from "#shared/ipc/settings.ts";
import type { ConversationsUsage } from "#shared/ipc/storage.ts";

import { createAgentModels } from "./agent-models.ts";
import type { AgentModelsOptions } from "./agent-models.ts";
import type { McpServers } from "./mcp-servers.ts";
import { loginShellPath } from "./shell-path.ts";

interface AgentServiceOptions extends AgentModelsOptions {
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
  /** The web search vendor the user set up; `undefined` until its key is saved. */
  web: () => Promise<(WebSearch & WebReader) | undefined>;
  desk: ProposingDesk;
  mcp: McpServers;
  memory: MemoryStore;
}

// `vp pack` ships QuickJS beside the main bundle and builds the scripts' worker next to it.
const SCRIPT_FILES = {
  wasm: join(import.meta.dirname, "quickjs.wasm"),
  worker: pathToFileURL(join(import.meta.dirname, "../worker/script.mjs")),
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

  // Every window shows the same conversations, so every window hears every run.
  const onEvent = (sessionId: string, event: AgentWireEvent) => {
    const update: AgentUpdate = { sessionId, event };

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

  const trading = createTradingExtension({
    marketData: options.marketData,
    watchlist: options.watchlist,
    news: options.news,
    desk: options.desk,
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

  const memory = createMemory({ store: options.memory });

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
          ...(shellOn() ? [shell.extension(guard)] : []),
          ...(webOn ? [web.extension(guard)] : []),
          ...(options.config.read().agent.memory
            ? [memory.extension(guard)]
            : []),
          mcp.search,
          mcpScriptExtension(mcp.catalog, scripts),
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

  return {
    models,
    skills,
    instructions,

    resume: () => runtime.resume(),

    sessions: () => runtime.sessions(),

    createSession: () => runtime.create(),

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

    send(id: string, text: string, focus: AgentFocus | null, locale: Locale) {
      return runtime.send(id, {
        text,
        context: formatContext({
          now: new Date(),
          brokerMode: options.desk.mode,
          focus: focus ?? undefined,
          locale,
        }),
      });
    },
  };
}

export type AgentService = ReturnType<typeof createAgentService>;
