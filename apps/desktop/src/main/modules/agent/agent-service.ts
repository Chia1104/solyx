import { BrowserWindow } from "electron";

import { formatContext } from "@solyx/agent/prompt";
import { createAgentRuntime } from "@solyx/agent/runtime";
import type { AgentConversationStore } from "@solyx/agent/runtime";
import { loadInstructions, loadSkillCatalog } from "@solyx/agent/skills";
import type { SkillFolders } from "@solyx/agent/skills";
import { createTradingExtension } from "@solyx/agent/tools";
import type { AgentWireEvent } from "@solyx/agent/wire";
import type { BrokerAdapter } from "@solyx/core/broker";
import type { Market, SymbolRef } from "@solyx/core/market";
import type { MarketDataProvider } from "@solyx/core/market-data";
import type { NewsSource, NewsStore } from "@solyx/core/news";
import type { OrderDesk } from "@solyx/core/order-desk";
import type { SentimentScorer } from "@solyx/core/sentiment";

import { agentEvents } from "#shared/ipc/agent.ts";
import type { AgentFocus, AgentUpdate } from "#shared/ipc/agent.ts";
import type { Locale } from "#shared/ipc/settings.ts";

import { createAgentModels } from "./agent-models.ts";
import type { AgentModelsOptions } from "./agent-models.ts";
import type { McpServers } from "./mcp-servers.ts";
import { createToolApprovals } from "./tool-approvals.ts";

interface AgentServiceOptions extends AgentModelsOptions {
  skillFolders: SkillFolders;
  /** AGENTS.md beside the config file. */
  instructionsFile: string;
  /** Where conversations persist, opening as the app starts. */
  conversations: Promise<AgentConversationStore>;
  marketData: (market: Market) => Promise<MarketDataProvider | undefined>;
  watchlist: () => SymbolRef[];
  newsSources: () => Promise<NewsSource[]>;
  newsStore: NewsStore;
  scorer: () => Promise<SentimentScorer | undefined>;
  broker: BrokerAdapter;
  desk: OrderDesk;
  mcp: McpServers;
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

  const approvals = createToolApprovals(onEvent);

  const trading = createTradingExtension({
    marketData: options.marketData,
    watchlist: options.watchlist,
    newsSources: options.newsSources,
    newsStore: options.newsStore,
    scorer: options.scorer,
    account: () => options.broker.getAccount(),
    brokerMode: options.broker.mode,
    desk: options.desk,
    skills: async () =>
      (await skills()).skills.filter((skill) => skill.offered),
    instructions,
  });

  const runtime = createAgentRuntime({
    store: options.conversations,
    models: models.catalog,
    model: () => models.choice(),
    async extensions() {
      const mcp = await options.mcp.extensions((call, signal) =>
        approvals.request(call.sessionId, call.toolCallId, signal)
      );

      // MCP tools wait until the agent finds them, so only the servers' names ride every request.
      return { offered: [trading, mcp.search], deferred: [mcp.tools] };
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

    /** The conversation as wire events, with calls still waiting for the user asked again. */
    transcript: async (id: string) => [
      ...(await runtime.transcript(id)),
      ...approvals.open(id),
    ],

    abort: (id: string) => runtime.abort(id),

    approve: (id: string, toolCallId: string, approved: boolean) =>
      approvals.decide(id, toolCallId, approved),

    /** Closes the conversations, then the MCP servers their runs used, as the app quits. */
    async close() {
      await runtime.close();
      await options.mcp.close();
    },

    send(id: string, text: string, focus: AgentFocus | null, locale: Locale) {
      return runtime.send(id, {
        text,
        context: formatContext({
          now: new Date(),
          brokerMode: options.broker.mode,
          focus: focus ?? undefined,
          locale,
        }),
      });
    },
  };
}
