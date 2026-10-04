import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { BrowserWindow } from "electron";

import { createAnalysis } from "@solyx/agent/analysis";
import { formatContext } from "@solyx/agent/prompt";
import { createAgentRuntime } from "@solyx/agent/runtime";
import type { AgentConversationStore } from "@solyx/agent/runtime";
import { loadInstructions, loadSkillCatalog } from "@solyx/agent/skills";
import type { SkillFolders } from "@solyx/agent/skills";
import { createTradingExtension } from "@solyx/agent/tools";
import type { AgentWireEvent } from "@solyx/agent/wire";
import type { SymbolRef } from "@solyx/core/market";
import type { MarketData } from "@solyx/core/market-data";
import type { NewsDesk } from "@solyx/core/news";
import type { ProposingDesk } from "@solyx/core/order-desk";

import { agentEvents } from "#shared/ipc/agent.ts";
import type { AgentFocus, AgentUpdate } from "#shared/ipc/agent.ts";
import type { Locale } from "#shared/ipc/settings.ts";

import { createAgentModels } from "./agent-models.ts";
import type { AgentModelsOptions } from "./agent-models.ts";
import type { McpServers } from "./mcp-servers.ts";

interface AgentServiceOptions extends AgentModelsOptions {
  skillFolders: SkillFolders;
  /** AGENTS.md beside the config file. */
  instructionsFile: string;
  /** Where conversations persist, opening as the app starts. */
  conversations: Promise<AgentConversationStore>;
  marketData: MarketData;
  watchlist: () => SymbolRef[];
  news: NewsDesk;
  desk: ProposingDesk;
  mcp: McpServers;
}

// `vp pack` ships QuickJS beside the main bundle and builds the scripts' worker next to it.
const ANALYSIS_FILES = {
  wasm: join(import.meta.dirname, "quickjs.wasm"),
  worker: pathToFileURL(join(import.meta.dirname, "../worker/analysis.mjs")),
};

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

  const trading = createTradingExtension({
    marketData: options.marketData,
    watchlist: options.watchlist,
    news: options.news,
    desk: options.desk,
    skills: async () =>
      (await skills()).skills.filter((skill) => skill.offered),
    instructions,
  });

  const analysis = createAnalysis({
    marketData: options.marketData,
    watchlist: options.watchlist,
    desk: options.desk,
    files: ANALYSIS_FILES,
  });

  const runtime = createAgentRuntime({
    store: options.conversations,
    models: models.models,
    model: () => models.choice(),
    async tools(guard) {
      const mcp = await options.mcp.extensions(guard);

      // MCP tools wait until the agent finds them, so only the servers' names ride every request.
      return {
        offered: [trading, analysis.extension, mcp.search],
        deferred: [mcp.tools],
      };
    },
    onEvent,
  });

  return {
    models,
    skills,
    instructions,

    resume: () => runtime.resume(),

    sessions: () => runtime.sessions(),

    createSession: () => runtime.create(),

    deleteSession: (id: string) => runtime.delete(id),

    transcript: (id: string) => runtime.transcript(id),

    abort: (id: string) => runtime.abort(id),

    approve: (id: string, toolCallId: string, approved: boolean) =>
      runtime.approve(id, toolCallId, approved),

    /** Closes the conversations, then the scripts and MCP servers their runs used, as the app quits. */
    async close() {
      await runtime.close();
      await analysis.close();
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
