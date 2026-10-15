import type { AgentModelPick } from "@solyx/agent/providers";
import type {
  AgentSession,
  AgentSessionSetup,
  AgentWireEvent,
  ApprovalMode,
  CompactionOutcome,
} from "@solyx/agent/wire";
import type { Interval } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";

import type { ChartIndicator } from "../chart-indicator.ts";
import type { OverviewTab } from "../overview-tab.ts";
import type { SettingsSection } from "../settings-section.ts";
import type { Locale, TimeZone } from "../settings.ts";

export const ScreenKind = {
  Listing: "listing",
  Overview: "overview",
  Settings: "settings",
} as const;

export type ScreenKind = (typeof ScreenKind)[keyof typeof ScreenKind];

/** What the window shows while the user writes, which the agent is told about. */
export type AgentScreen =
  | {
      kind: typeof ScreenKind.Listing;
      symbol: SymbolRef;
      /** The exchange's name for it, as the renderer already shows it. */
      name?: string;
      interval: Interval;
      /** What its chart draws with its bars on that interval. */
      indicators: ChartIndicator[];
    }
  | { kind: typeof ScreenKind.Overview; tab: OverviewTab }
  | { kind: typeof ScreenKind.Settings; section: SettingsSection };

export interface AgentApi {
  /** Most recently active first. */
  sessions(): Promise<AgentSession[]>;
  /** Starts on what the user picked before its first message. */
  createSession(setup: AgentSessionSetup): Promise<AgentSession>;
  /** Stops its run first, if one is going. */
  deleteSession(id: string): Promise<void>;
  /** The conversation as wire events to fold, including a run still going. */
  transcript(id: string): Promise<AgentWireEvent[]>;
  /**
   * Starts a run and resolves once it is under way; its progress arrives through `onEvent`.
   * `locale` is the app's language, which the agent replies in, and `timeZone` the user's own
   * clock, which the agent is told the time on.
   */
  send(
    id: string,
    text: string,
    screen: AgentScreen | null,
    locale: Locale,
    timeZone: TimeZone
  ): Promise<void>;
  abort(id: string): Promise<void>;
  /**
   * Summarizes the conversation's older messages, guided by `instructions`, and resolves once the
   * summary is placed or nothing is old enough. Stopping the conversation stops it.
   */
  compact(id: string, instructions: string | null): Promise<CompactionOutcome>;
  /** Answers a call waiting for the user to allow it. */
  approve(id: string, toolCallId: string, approved: boolean): Promise<void>;
  /** Sets whether the conversation's tool calls ask first, from its next call on. */
  setApprovalMode(id: string, mode: ApprovalMode): Promise<void>;
  /** Sets the model the conversation runs on from its next run; `null` parts follow the default. */
  setModel(id: string, pick: AgentModelPick): Promise<void>;
  /**
   * Whether the conversations' store failed, after which none of them is read or written until
   * the app starts again.
   */
  storeFailed(): Promise<boolean>;
  /** Quits the app and starts it again, which a failed store needs. */
  restart(): Promise<void>;
}

export interface AgentUpdate {
  sessionId: string;
  event: AgentWireEvent;
}

/** Pushes from the main process; each subscription returns a function that stops listening. */
export interface AgentEvents {
  onEvent(listener: (update: AgentUpdate) => void): () => void;
  /** The conversations' store failed, which `storeFailed` tells from then on. */
  onStoreFailed(listener: () => void): () => void;
}

export const agentChannels = {
  sessions: "agent:sessions",
  createSession: "agent:create-session",
  deleteSession: "agent:delete-session",
  transcript: "agent:transcript",
  send: "agent:send",
  abort: "agent:abort",
  compact: "agent:compact",
  approve: "agent:approve",
  setApprovalMode: "agent:set-approval-mode",
  setModel: "agent:set-model",
  storeFailed: "agent:store-failed",
  restart: "agent:restart",
} as const satisfies Record<keyof AgentApi, string>;

export const agentEvents = {
  onEvent: "agent:event",
  onStoreFailed: "agent:store-failure",
} as const satisfies Record<keyof AgentEvents, string>;
