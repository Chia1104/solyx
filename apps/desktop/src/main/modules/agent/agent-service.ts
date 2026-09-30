import type { CredentialStore } from "@earendil-works/pi-ai";
import { BrowserWindow } from "electron";

import type { SignInOutcome } from "@solyx/agent/chatgpt-oauth";
import { formatContext, systemPrompt } from "@solyx/agent/prompt";
import { createAgentRuntime } from "@solyx/agent/runtime";
import { loadInstructions, loadSkillCatalog } from "@solyx/agent/skills";
import type { SkillFolders } from "@solyx/agent/skills";
import { createTradingTools } from "@solyx/agent/tools";
import type { AgentSessionStore } from "@solyx/agent/transcript";
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
import type { SecretStore } from "../settings/secret-store.ts";

import { createAgentModels } from "./agent-models.ts";
import type { McpServers } from "./mcp-servers.ts";
import { createToolApprovals } from "./tool-approvals.ts";

export interface AgentServiceOptions {
  config: ConfigFile;
  secrets: SecretStore;
  credentials: CredentialStore;
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
  sessions: AgentSessionStore;
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

  // Read for every run and every settings view, so edits apply without a restart.
  const skills = () =>
    loadSkillCatalog(
      options.skillFolders,
      new Set(options.config.read().agent?.sharedSkills)
    );

  const instructions = () => loadInstructions(options.instructionsFile);

  const onEvent = (sessionId: string, event: AgentWireEvent) =>
    broadcast({ sessionId, event });

  const approvals = createToolApprovals(onEvent);

  const runtime = createAgentRuntime({
    store: options.sessions,
    streamFn: (model, context, streamOptions) =>
      models.catalog.streamSimple(model, context, streamOptions),
    model: () => models.choice(),
    async prepare(sessionId) {
      const [catalog, standing, mcpTools] = await Promise.all([
        skills(),
        instructions(),
        options.mcp.tools((call, signal) =>
          approvals.request(sessionId, call.toolCallId, signal)
        ),
      ]);

      const offered = catalog.skills.filter((skill) => skill.offered);

      return {
        systemPrompt: systemPrompt({ skills: offered, instructions: standing }),
        tools: [
          ...createTradingTools({
            marketData: options.marketData,
            watchlist: options.watchlist,
            account: () => options.broker.getAccount(),
            brokerMode: options.broker.mode,
            desk: options.desk,
            skills: offered,
          }),
          ...mcpTools,
        ],
      };
    },
    onEvent,
  });

  return {
    models,
    runtime,
    skills,
    instructions,

    /** The conversation as wire events, with calls still waiting for the user asked again. */
    transcript: (id: string) => [
      ...runtime.transcript(id),
      ...approvals.open(id),
    ],

    approve: (id: string, toolCallId: string, approved: boolean) =>
      approvals.decide(id, toolCallId, approved),

    /** Stops every run, then the MCP servers they used, as the app quits. */
    async close() {
      await runtime.stopAll();
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
