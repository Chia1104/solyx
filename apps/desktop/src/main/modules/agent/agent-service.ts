import { BrowserWindow } from "electron";

import type { SignInOutcome } from "@solyx/agent/chatgpt-oauth";
import { formatContext } from "@solyx/agent/prompt";
import { createAgentRuntime } from "@solyx/agent/runtime";
import type { AgentConversationStore } from "@solyx/agent/runtime";
import { loadInstructions, loadSkillCatalog } from "@solyx/agent/skills";
import type { SkillFolders } from "@solyx/agent/skills";
import { createTradingExtension } from "@solyx/agent/tools";
import type { AgentWireEvent } from "@solyx/agent/wire";
import type { BrokerAdapter } from "@solyx/core/broker";
import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { MarketDataProvider } from "@solyx/core/market-data";
import type { OrderDesk } from "@solyx/core/order-desk";
import { getSession } from "@solyx/core/session";

import { agentEvents } from "#shared/ipc/agent.ts";
import type { AgentFocus, AgentUpdate } from "#shared/ipc/agent.ts";

import type { ConfigFile } from "../settings/config-file.ts";
import type { AgentCredentials } from "../settings/credential-store.ts";
import type { SecretStore } from "../settings/secret-store.ts";

import { createAgentModels } from "./agent-models.ts";
import type { McpServers } from "./mcp-servers.ts";
import { createToolApprovals } from "./tool-approvals.ts";

export interface AgentServiceOptions {
  config: ConfigFile;
  secrets: SecretStore;
  credentials: AgentCredentials;
  getDeviceId: () => string;
  openExternal: (url: string) => void;
  signInPage: (
    locale: string,
    outcome: SignInOutcome,
    detail?: string
  ) => string;
  skillFolders: SkillFolders;
  /** AGENTS.md beside the config file. */
  instructionsFile: string;
  /** Where conversations persist, opening as the app starts. */
  conversations: Promise<AgentConversationStore>;
  marketData: (market: Market) => Promise<MarketDataProvider | undefined>;
  watchlist: () => SymbolRef[];
  broker: BrokerAdapter;
  desk: OrderDesk;
  mcp: McpServers;
}

// Every window shows the same conversations, so every window hears every run.
function broadcast(update: AgentUpdate) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(agentEvents.onEvent, update);
  }
}

/** The agent as the app wires it: the user's model and key, the trading tools and the desk. */
export function createAgentService(options: AgentServiceOptions) {
  const models = createAgentModels(options);

  // Read for every request and every settings view, so edits apply without a restart.
  const skills = () =>
    loadSkillCatalog(
      options.skillFolders,
      new Set(options.config.read().agent?.sharedSkills)
    );

  const instructions = () => loadInstructions(options.instructionsFile);

  const onEvent = (sessionId: string, event: AgentWireEvent) =>
    broadcast({ sessionId, event });

  const approvals = createToolApprovals(onEvent);

  const trading = createTradingExtension({
    marketData: options.marketData,
    watchlist: options.watchlist,
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
    extensions: async () => [
      trading,
      await options.mcp.extension((call, signal) =>
        approvals.request(call.sessionId, call.toolCallId, signal)
      ),
    ],
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

    send(id: string, text: string, focus: AgentFocus | null, locale: string) {
      const now = new Date();

      return runtime.send(id, {
        text,
        context: formatContext({
          now,
          sessions: {
            [Market.TW]: getSession(Market.TW, now),
            [Market.US]: getSession(Market.US, now),
          },
          brokerMode: options.broker.mode,
          focus: focus ?? undefined,
          locale,
        }),
      });
    },
  };
}

export type AgentService = ReturnType<typeof createAgentService>;
