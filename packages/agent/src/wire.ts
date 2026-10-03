/**
 * What the main process tells a renderer about a conversation, and the fold that turns it into
 * what the thread shows. A live run and a replayed transcript go through the same fold, and this
 * module imports nothing from pi, so the renderer can use it.
 */

import * as z from "zod";

/** One conversation with the agent. */
export interface AgentSession {
  id: string;
  /** Empty until the first message names it. */
  title: string;
  createdAt: number;
  updatedAt: number;
}

/** The agent's tools, which the renderer labels and whose `details` it narrows by name. */
export const AgentToolName = {
  GetMarketStatus: "get_market_status",
  GetCandles: "get_candles",
  GetIndicators: "get_indicators",
  GetNews: "get_news",
  GetWatchlist: "get_watchlist",
  GetAccount: "get_account",
  ListProposals: "list_proposals",
  CheckOrder: "check_order",
  ProposeOrder: "propose_order",
  ReadSkill: "read_skill",
  SearchTools: "search_tools",
} as const;

export type AgentToolName = (typeof AgentToolName)[keyof typeof AgentToolName];

export const proposeOrderDetailsSchema = z.object({ proposalId: z.string() });

export type ProposeOrderDetails = z.infer<typeof proposeOrderDetailsSchema>;

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
    }
  | { type: typeof AgentEventType.ApprovalRequest; toolCallId: string }
  | {
      type: typeof AgentEventType.ApprovalResolved;
      toolCallId: string;
      approved: boolean;
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
      const tool: ToolCallView = {
        kind: AgentItemKind.Tool,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        status: ToolCallStatus.Running,
      };

      // A resumed round may start a call the replayed transcript already shows.
      const index = findTool(event.toolCallId);

      if (index === -1) items.push(tool);
      else items[index] = tool;

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
      items[index] = {
        ...tool,
        status:
          event.type === AgentEventType.ApprovalRequest
            ? ToolCallStatus.AwaitingApproval
            : ToolCallStatus.Running,
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
