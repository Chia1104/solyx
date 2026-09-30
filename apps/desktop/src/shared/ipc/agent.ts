import type { AgentSession } from "@solyx/agent/transcript";
import type { AgentWireEvent } from "@solyx/agent/wire";
import type { SymbolRef } from "@solyx/core/market";

/** The listing the user has open while writing, which the agent is told about. */
export interface AgentFocus {
  symbol: SymbolRef;
  /** The exchange's name for it, as the renderer already shows it. */
  name?: string;
}

export interface AgentApi {
  /** Most recently active first. */
  sessions(): Promise<AgentSession[]>;
  createSession(): Promise<AgentSession>;
  /** Stops its run first, if one is going. */
  deleteSession(id: string): Promise<void>;
  /** The conversation as wire events to fold, including a run still going. */
  transcript(id: string): Promise<AgentWireEvent[]>;
  /**
   * Starts a run and resolves once it is under way; its progress arrives through `onEvent`.
   * `locale` is the app's language, which the agent replies in.
   */
  send(
    id: string,
    text: string,
    focus: AgentFocus | null,
    locale: string
  ): Promise<void>;
  abort(id: string): Promise<void>;
  /** Answers a call waiting for the user to allow it. */
  approve(id: string, toolCallId: string, approved: boolean): Promise<void>;
}

export interface AgentUpdate {
  sessionId: string;
  event: AgentWireEvent;
}

/** Pushes from the main process; each subscription returns a function that stops listening. */
export interface AgentEvents {
  onEvent(listener: (update: AgentUpdate) => void): () => void;
}

export const agentChannels = {
  sessions: "agent:sessions",
  createSession: "agent:create-session",
  deleteSession: "agent:delete-session",
  transcript: "agent:transcript",
  send: "agent:send",
  abort: "agent:abort",
  approve: "agent:approve",
} as const satisfies Record<keyof AgentApi, string>;

export const agentEvents = {
  onEvent: "agent:event",
} as const satisfies Record<keyof AgentEvents, string>;
