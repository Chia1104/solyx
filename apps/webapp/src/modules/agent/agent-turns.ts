import {
  AgentItemKind,
  AgentToolName,
  ToolCallStatus,
  getSectorsDetailsSchema,
  proposeOrderDetailsSchema,
  runAnalysisDetailsSchema,
  submitForecastDetailsSchema,
} from "@solyx/agent/wire";
import type {
  AgentViewItem,
  CompactionView,
  MessageView,
  NoticeView,
  ToolCallView,
} from "@solyx/agent/wire";

/** What a call holds for the user to act on or read: its proposal, vote, forecast, map or backtests. */
export function callCards(tool: ToolCallView) {
  const ok = tool.status === ToolCallStatus.Ok;

  const proposal =
    ok &&
    (tool.toolName === AgentToolName.ProposeOrder ||
      tool.toolName === AgentToolName.ProposeExit)
      ? proposeOrderDetailsSchema.safeParse(tool.details).data
      : undefined;

  const forecast =
    ok && tool.toolName === AgentToolName.SubmitForecast
      ? submitForecastDetailsSchema.safeParse(tool.details).data
      : undefined;

  // The sectors as the call read them, not as they trade now, so the map agrees with the reply.
  const sectors =
    ok && tool.toolName === AgentToolName.GetSectors
      ? getSectorsDetailsSchema.safeParse(tool.details).data?.sectors
      : undefined;

  const backtests =
    tool.toolName === AgentToolName.RunAnalysis
      ? runAnalysisDetailsSchema.safeParse(tool.details).data?.backtests
      : undefined;

  return { proposal, forecast, sectors, backtests };
}

/** Whether a call waits on the user or holds something for them, so it stays in view. */
function holdsCard(tool: ToolCallView) {
  if (tool.status === ToolCallStatus.AwaitingApproval) return true;

  const { proposal, forecast, sectors, backtests } = callCards(tool);

  return Boolean(
    proposal?.proposalId ||
    proposal?.council ||
    forecast?.forecastId ||
    sectors ||
    backtests?.length
  );
}

export const WorkKind = {
  Thinking: "thinking",
  /** What the agent said between its calls, which a later call made part of the work. */
  Text: "text",
  Tool: "tool",
} as const;

export type WorkKind = (typeof WorkKind)[keyof typeof WorkKind];

export type WorkItem =
  | { kind: typeof WorkKind.Thinking; message: MessageView }
  | { kind: typeof WorkKind.Text; message: MessageView }
  | { kind: typeof WorkKind.Tool; tool: ToolCallView };

/** One exchange: the user's message and everything the agent did to answer it. */
export interface Turn {
  /** The user's message's id, or `start` for what came before the first. */
  key: string;
  user?: MessageView;
  /** What followed the user's message, in order. */
  items: readonly AgentViewItem[];
  /** What the agent worked through, which folds away under one heading. */
  work: WorkItem[];
  /** Calls that wait on the user or hold something for them, which stay in view. */
  cards: ToolCallView[];
  /** The last reply, once no call has followed it; while it streams, it may still become work. */
  answer?: MessageView;
  /** How the run ended where it did not simply finish, and where a summary took over. */
  after: (NoticeView | CompactionView)[];
}

const sameItems = (
  left: readonly AgentViewItem[],
  right: readonly AgentViewItem[]
) =>
  left.length === right.length && left.every((item, at) => item === right[at]);

/** The last reply, once no call has followed it. */
function answerOf(items: readonly AgentViewItem[]) {
  const last = items.findLast(
    (item) =>
      item.kind === AgentItemKind.Assistant || item.kind === AgentItemKind.Tool
  );

  return last?.kind === AgentItemKind.Assistant && last.text ? last : undefined;
}

/** Where an item of a turn shows: in its work, among its cards or after its answer. */
function place(turn: Turn, item: AgentViewItem) {
  switch (item.kind) {
    case AgentItemKind.Assistant:
      if (item.thinking) {
        turn.work.push({ kind: WorkKind.Thinking, message: item });
      }

      if (item.text && item !== turn.answer) {
        turn.work.push({ kind: WorkKind.Text, message: item });
      }

      return;
    case AgentItemKind.Tool:
      if (holdsCard(item)) turn.cards.push(item);
      else turn.work.push({ kind: WorkKind.Tool, tool: item });

      return;
    case AgentItemKind.Notice:
    case AgentItemKind.Compaction:
      turn.after.push(item);

      return;
    default:
      return;
  }
}

function turnOf(
  key: string,
  user: MessageView | undefined,
  items: AgentViewItem[]
): Turn {
  const turn: Turn = {
    key,
    user,
    items,
    work: [],
    cards: [],
    answer: answerOf(items),
    after: [],
  };

  for (const item of items) place(turn, item);

  return turn;
}

/**
 * The thread as exchanges, each opened by a message of the user's. A turn whose items are the
 * ones `previous` held keeps its object, so only the turn that changed renders again.
 */
export function threadTurns(
  items: readonly AgentViewItem[],
  previous: readonly Turn[] = []
): Turn[] {
  const groups: { user?: MessageView; items: AgentViewItem[] }[] = [];

  for (const item of items) {
    if (item.kind === AgentItemKind.User) {
      groups.push({ user: item, items: [] });
    } else {
      if (groups.length === 0) groups.push({ items: [] });

      groups.at(-1)?.items.push(item);
    }
  }

  return groups.map(({ user, items: held }) => {
    const key = user?.messageId ?? "start";
    const kept = previous.find((turn) => turn.key === key);

    return kept && kept.user === user && sameItems(kept.items, held)
      ? kept
      : turnOf(key, user, held);
  });
}

export const StepKind = {
  /** A call being written, running or waiting on the user. */
  Tool: "tool",
  Thinking: "thinking",
  /** The answer streams under the work. */
  Answering: "answering",
  /** A request is out to the model, before anything of its reply has come. */
  Working: "working",
} as const;

export type StepKind = (typeof StepKind)[keyof typeof StepKind];

export type Step =
  | { kind: typeof StepKind.Tool; tool: ToolCallView }
  | {
      kind:
        | typeof StepKind.Thinking
        | typeof StepKind.Answering
        | typeof StepKind.Working;
    };

const LIVE_STATUSES = new Set<ToolCallStatus>([
  ToolCallStatus.Drafting,
  ToolCallStatus.Running,
]);

/**
 * What a running turn is on now: a call of the latest reply that waits on the user before one
 * still being written or run, else what the latest reply is streaming.
 */
export function currentStep(turn: Turn): Step {
  const { items } = turn;

  const reply = items.findLastIndex(
    (item) => item.kind === AgentItemKind.Assistant
  );

  const calls = items
    .slice(reply + 1)
    .filter((item) => item.kind === AgentItemKind.Tool);

  const call =
    calls.findLast((tool) => tool.status === ToolCallStatus.AwaitingApproval) ??
    calls.findLast((tool) => LIVE_STATUSES.has(tool.status));

  if (call) return { kind: StepKind.Tool, tool: call };

  const message = items[reply];

  if (message?.kind === AgentItemKind.Assistant && message.streaming) {
    if (message.text) return { kind: StepKind.Answering };

    if (message.thinking) return { kind: StepKind.Thinking };
  }

  return { kind: StepKind.Working };
}

/** How many calls the agent made itself, not counting those its scripts made. */
export function stepCount(turn: Turn) {
  return turn.items.filter(
    (item) =>
      item.kind === AgentItemKind.Tool && item.parentToolCallId === undefined
  ).length;
}

/** Whole seconds from the user's message to the agent's last reply, where both kept a time. */
export function turnSeconds(turn: Turn) {
  const sent = turn.user?.at;

  const replied = turn.items.findLast(
    (item) => item.kind === AgentItemKind.Assistant && item.at !== undefined
  );

  if (sent === undefined || replied?.kind !== AgentItemKind.Assistant) {
    return undefined;
  }

  return replied.at === undefined
    ? undefined
    : Math.max(0, Math.round((replied.at - sent) / 1000));
}
