/**
 * What the main process tells a renderer about a conversation, and the fold that turns it into
 * what the thread shows. A live run and a replayed transcript go through the same fold, and this
 * module imports nothing from pi, so the renderer can use it.
 */

import * as z from "zod";

import { councilSchema } from "@solyx/core/council";
import { symbolRefSchema } from "@solyx/core/market";
import {
  memoryBodySchema,
  memoryDescriptionSchema,
  memoryKindSchema,
} from "@solyx/core/memory";

import { agentModelPickSchema } from "./providers.ts";
import type { AgentModelRef, AgentThinking } from "./providers.ts";

/** How a conversation's calls that must ask get past the approval gate. */
export const ApprovalMode = {
  /** Each call waits for the user to allow it. */
  Ask: "ask",
  /**
   * A shell command the decisions model judges harmless runs, and a page the conversation's own
   * searches or news found is read; every other call still asks.
   */
  Auto: "auto",
  /** Calls run without asking, shell commands included. */
  Bypass: "bypass",
} as const;

export type ApprovalMode = (typeof ApprovalMode)[keyof typeof ApprovalMode];

export const approvalModeSchema = z.enum(ApprovalMode);

/** One conversation with the agent. */
export interface AgentSession {
  id: string;
  /** Empty until the first message names it. */
  title: string;
  createdAt: number;
  updatedAt: number;
  approvalMode: ApprovalMode;
  /** The model the user picked for it; `null` follows the default model. */
  model: AgentModelRef | null;
  /** How long its model thinks; `null` follows the default. */
  thinking: AgentThinking | null;
}

/** What a new conversation starts on, picked before its first message. */
export const agentSessionSetupSchema = agentModelPickSchema.extend({
  approvalMode: approvalModeSchema,
});

export type AgentSessionSetup = z.infer<typeof agentSessionSetupSchema>;

/** The agent's tools, which the renderer labels and whose `details` it narrows by name. */
export const AgentToolName = {
  GetMarketStatus: "get_market_status",
  GetCandles: "get_candles",
  GetIndicators: "get_indicators",
  GetNews: "get_news",
  GetWatchlist: "get_watchlist",
  GetCalendar: "get_calendar",
  GetAccount: "get_account",
  ListProposals: "list_proposals",
  CheckOrder: "check_order",
  ProposeOrder: "propose_order",
  ReadSkill: "read_skill",
  SearchTools: "search_tools",
  RunAnalysis: "run_analysis",
  RunToolScript: "run_tool_script",
  WebSearch: "web_search",
  ReadPage: "read_page",
  Recall: "recall",
  Remember: "remember",
  Forget: "forget",
  GetResearch: "get_research",
  GetFundamentals: "get_fundamentals",
  ReviseReport: "revise_report",
  SubmitForecast: "submit_forecast",
  SearchHistory: "search_history",
  /** pi-durable's name for the shell tool, whatever shell runs it. */
  Bash: "bash",
} as const;

export type AgentToolName = (typeof AgentToolName)[keyof typeof AgentToolName];

/** What a proposal's call left: the proposal, unless a vote rejected it, and the vote where one was held. */
export const proposeOrderDetailsSchema = z.object({
  proposalId: z.string().optional(),
  council: councilSchema.optional(),
});

export type ProposeOrderDetails = z.infer<typeof proposeOrderDetailsSchema>;

export const reviseReportDetailsSchema = z.object({
  symbol: symbolRefSchema,
  revision: z.number(),
});

export type ReviseReportDetails = z.infer<typeof reviseReportDetailsSchema>;

/** What a forecast's call left: the forecast, or the vote that rejected it. */
export const submitForecastDetailsSchema = z.object({
  symbol: symbolRefSchema,
  forecastId: z.string().optional(),
  council: councilSchema.optional(),
});

export type SubmitForecastDetails = z.infer<typeof submitForecastDetailsSchema>;

/** The arguments of the tools that run a script the agent wrote. */
export const scriptArgumentsSchema = z.object({
  code: z.string().min(1).describe("The body of an async function"),
});

export const runAnalysisDetailsSchema = z.object({
  /** What the script printed and returned, or how it failed. */
  output: z.string(),
});

export type RunAnalysisDetails = z.infer<typeof runAnalysisDetailsSchema>;

export const bashArgumentsSchema = z.object({ command: z.string() });

export const readPageArgumentsSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).describe("The page's full address"),
});

/** A memory the agent saves, or rewrites whole under its id, once the user allows it. */
export const rememberArgumentsSchema = z.object({
  id: z
    .string()
    .optional()
    .describe(
      "A memory's id from the list, to rewrite it whole; left out, a new memory is saved"
    ),
  kind: memoryKindSchema.describe(
    "profile: who the user is, their goals and limits; feedback: how they want you to work; note: a thesis or fact worth keeping"
  ),
  listing: symbolRefSchema
    .optional()
    .describe("The listing it is about, if one"),
  description: memoryDescriptionSchema.describe(
    "The one line the memory list shows: what it holds and when it matters. For profile and feedback, the rule itself"
  ),
  body: memoryBodySchema
    .default("")
    .describe("The details recall reads; may be empty"),
});

export const forgetArgumentsSchema = z.object({
  id: z.string().describe("A memory's id from the list"),
});

export const AgentEventType = {
  RunStart: "run:start",
  User: "user",
  AssistantStart: "assistant:start",
  AssistantDelta: "assistant:delta",
  AssistantEnd: "assistant:end",
  ToolStart: "tool:start",
  ToolEnd: "tool:end",
  ApprovalRequest: "approval:request",
  ApprovalResolved: "approval:resolved",
  RunEnd: "run:end",
} as const;

export type AgentEventType =
  (typeof AgentEventType)[keyof typeof AgentEventType];

export const DeltaChannel = {
  Text: "text",
  Thinking: "thinking",
} as const;

export type DeltaChannel = (typeof DeltaChannel)[keyof typeof DeltaChannel];

export const ToolCallStatus = {
  Running: "running",
  /** Waits for the user to allow it before it runs. */
  AwaitingApproval: "awaiting-approval",
  Ok: "ok",
  Error: "error",
  /** The call never got a result: the run stopped or the app exited first. */
  Aborted: "aborted",
} as const;

export type ToolCallStatus =
  (typeof ToolCallStatus)[keyof typeof ToolCallStatus];

/** A tool call a script made inside one of the agent's calls. */
export const nestedCallSchema = z.object({
  /** `<the call's id>/<n>`, which its approval goes by. */
  id: z.string(),
  toolName: z.string(),
  args: z.json(),
  status: z.enum(ToolCallStatus).exclude(["AwaitingApproval"]),
  /** The first line of why it failed. */
  error: z.string().optional(),
});

export type NestedCall = z.infer<typeof nestedCallSchema>;

/** Details that list the tool calls a call made, which a transcript shows under it. */
export const nestedCallsSchema = z.object({ calls: z.array(nestedCallSchema) });

export const runToolScriptDetailsSchema = nestedCallsSchema.extend({
  /** What the script printed and returned, or how it failed, once it ended. */
  output: z.string().optional(),
});

export type RunToolScriptDetails = z.infer<typeof runToolScriptDetailsSchema>;

export const RunEndReason = {
  Done: "done",
  Aborted: "aborted",
  Error: "error",
  /** The app exited mid-run, so the transcript stops short. */
  Interrupted: "interrupted",
} as const;

export type RunEndReason = (typeof RunEndReason)[keyof typeof RunEndReason];

export type AgentWireEvent =
  | { type: typeof AgentEventType.RunStart }
  | {
      type: typeof AgentEventType.User;
      messageId: string;
      /** What the user typed, without the context the app attached for the model. */
      text: string;
      /** Epoch ms. */
      at: number;
    }
  | { type: typeof AgentEventType.AssistantStart; messageId: string }
  | {
      type: typeof AgentEventType.AssistantDelta;
      messageId: string;
      channel: DeltaChannel;
      delta: string;
    }
  | {
      type: typeof AgentEventType.AssistantEnd;
      messageId: string;
      text: string;
      thinking?: string;
      at: number;
    }
  | {
      type: typeof AgentEventType.ToolStart;
      toolCallId: string;
      toolName: string;
      args: unknown;
      /** The call whose script made this one. */
      parentToolCallId?: string;
    }
  | {
      type: typeof AgentEventType.ToolEnd;
      toolCallId: string;
      toolName: string;
      status: Exclude<
        ToolCallStatus,
        typeof ToolCallStatus.Running | typeof ToolCallStatus.AwaitingApproval
      >;
      /** The first line of what a failed call returned. */
      error?: string;
      /** The tool's own view model, which the renderer narrows by tool name. */
      details?: unknown;
      /** What a shell command printed, as much of it as the model was given. */
      output?: string;
    }
  | { type: typeof AgentEventType.ApprovalRequest; toolCallId: string }
  | {
      type: typeof AgentEventType.ApprovalResolved;
      toolCallId: string;
      approved: boolean;
      /** The decisions model allowed the call, in a conversation set to auto, not the user. */
      auto?: boolean;
    }
  | {
      type: typeof AgentEventType.RunEnd;
      reason: RunEndReason;
      /** The provider's or the runtime's message when `reason` is `error`. */
      error?: string;
    };

export type RunEndEvent = Extract<
  AgentWireEvent,
  { type: typeof AgentEventType.RunEnd }
>;

export type ToolStartEvent = Extract<
  AgentWireEvent,
  { type: typeof AgentEventType.ToolStart }
>;

export type ToolEndEvent = Extract<
  AgentWireEvent,
  { type: typeof AgentEventType.ToolEnd }
>;

export const AgentItemKind = {
  User: "user",
  Assistant: "assistant",
  Tool: "tool",
  Notice: "notice",
} as const;

export type AgentItemKind = (typeof AgentItemKind)[keyof typeof AgentItemKind];

export interface MessageView {
  kind: typeof AgentItemKind.User | typeof AgentItemKind.Assistant;
  messageId: string;
  text: string;
  thinking?: string;
  /** Epoch ms; unset while an assistant message is still streaming. */
  at?: number;
  streaming: boolean;
}

export interface ToolCallView {
  kind: typeof AgentItemKind.Tool;
  toolCallId: string;
  toolName: string;
  args: unknown;
  status: ToolCallStatus;
  error?: string;
  details?: unknown;
  output?: string;
  /** The check its tool was guarded with let the call run without asking the user. */
  autoApproved?: boolean;
  /** The call whose script made this one, which the thread shows it under. */
  parentToolCallId?: string;
}

/** How a run that did not simply finish ended. */
export interface NoticeView {
  kind: typeof AgentItemKind.Notice;
  reason: Exclude<RunEndReason, typeof RunEndReason.Done>;
  error?: string;
}

export type AgentViewItem = MessageView | ToolCallView | NoticeView;

export interface AgentView {
  items: AgentViewItem[];
  running: boolean;
}

export const emptyAgentView = (): AgentView => ({ items: [], running: false });

/** Pure: the same events in the same order always give the same view. */
export function applyEvent(view: AgentView, event: AgentWireEvent): AgentView {
  const items = view.items.slice();

  const findMessage = (messageId: string) =>
    items.findIndex(
      (item) =>
        item.kind === AgentItemKind.Assistant && item.messageId === messageId
    );

  const findTool = (toolCallId: string) =>
    items.findIndex(
      (item) =>
        item.kind === AgentItemKind.Tool && item.toolCallId === toolCallId
    );

  switch (event.type) {
    case AgentEventType.RunStart:
      return { items, running: true };

    case AgentEventType.User:
      items.push({
        kind: AgentItemKind.User,
        messageId: event.messageId,
        text: event.text,
        at: event.at,
        streaming: false,
      });

      return { ...view, items };

    case AgentEventType.AssistantStart:
      items.push({
        kind: AgentItemKind.Assistant,
        messageId: event.messageId,
        text: "",
        streaming: true,
      });

      return { ...view, items };

    case AgentEventType.AssistantDelta: {
      const index = findMessage(event.messageId);
      const message = items[index];

      if (message?.kind !== AgentItemKind.Assistant) return view;

      items[index] =
        event.channel === DeltaChannel.Text
          ? { ...message, text: message.text + event.delta }
          : { ...message, thinking: (message.thinking ?? "") + event.delta };

      return { ...view, items };
    }

    case AgentEventType.AssistantEnd: {
      const index = findMessage(event.messageId);

      const message: MessageView = {
        kind: AgentItemKind.Assistant,
        messageId: event.messageId,
        text: event.text,
        thinking: event.thinking,
        at: event.at,
        streaming: false,
      };

      if (index === -1) items.push(message);
      else items[index] = message;

      return { ...view, items };
    }

    case AgentEventType.ToolStart: {
      const { parentToolCallId } = event;

      const tool: ToolCallView = {
        kind: AgentItemKind.Tool,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        status: ToolCallStatus.Running,
        parentToolCallId,
      };

      // A resumed round may start a call the replayed transcript already shows.
      const index = findTool(event.toolCallId);

      if (index !== -1) {
        items[index] = tool;
      } else if (parentToolCallId === undefined) {
        items.push(tool);
      } else {
        // A script's call follows the script and the calls it made before, though other calls of
        // its round may have started since.
        const madeBefore = (item: AgentViewItem | undefined) =>
          item?.kind === AgentItemKind.Tool &&
          item.parentToolCallId === parentToolCallId;

        const parent = findTool(parentToolCallId);
        let at = parent === -1 ? items.length : parent + 1;

        while (madeBefore(items[at])) at += 1;

        items.splice(at, 0, tool);
      }

      return { ...view, items };
    }

    case AgentEventType.ToolEnd: {
      const index = findTool(event.toolCallId);
      const found = items[index];

      const tool: ToolCallView = {
        ...(found?.kind === AgentItemKind.Tool
          ? found
          : {
              kind: AgentItemKind.Tool,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: undefined,
            }),
        status: event.status,
        error: event.error,
        details: event.details,
        output: event.output,
      };

      if (index === -1) items.push(tool);
      else items[index] = tool;

      return { ...view, items };
    }

    case AgentEventType.ApprovalRequest:
    case AgentEventType.ApprovalResolved: {
      const index = findTool(event.toolCallId);
      const tool = items[index];

      if (tool?.kind !== AgentItemKind.Tool) return view;

      // Refused, the call still ends through its own `tool:end`, as an error.
      items[index] =
        event.type === AgentEventType.ApprovalRequest
          ? { ...tool, status: ToolCallStatus.AwaitingApproval }
          : {
              ...tool,
              status: ToolCallStatus.Running,
              autoApproved: event.auto,
            };

      return { ...view, items };
    }

    case AgentEventType.RunEnd: {
      // The run is over, so a call still running will get no result, and no message streams on.
      const settled = items.map((item): AgentViewItem => {
        if (
          item.kind === AgentItemKind.Tool &&
          (item.status === ToolCallStatus.Running ||
            item.status === ToolCallStatus.AwaitingApproval)
        ) {
          return { ...item, status: ToolCallStatus.Aborted };
        }

        if (item.kind === AgentItemKind.Assistant && item.streaming) {
          return { ...item, streaming: false };
        }

        return item;
      });

      if (event.reason !== RunEndReason.Done) {
        settled.push({
          kind: AgentItemKind.Notice,
          reason: event.reason,
          error: event.error,
        });
      }

      return { items: settled, running: false };
    }

    default: {
      const exhaustive: never = event;

      return exhaustive;
    }
  }
}

export const foldEvents = (
  events: readonly AgentWireEvent[],
  initial: AgentView = emptyAgentView()
): AgentView => events.reduce(applyEvent, initial);
