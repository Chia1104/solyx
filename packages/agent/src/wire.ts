/**
 * What the main process tells a renderer about a conversation, the fold that turns it into what
 * the thread shows, and what a message the user writes names. A live run and a replayed
 * transcript go through the same fold, and this module imports nothing from pi, so the renderer
 * can use it.
 */

import { uniq } from "es-toolkit";
import * as z from "zod";

import { ruleStrategySchema, tradeCostsSchema } from "@solyx/core/backtest";
import { intervalSchema } from "@solyx/core/candles";
import { EVERY_CHANGE, changeScopeSchema } from "@solyx/core/changes";
import { councilSchema } from "@solyx/core/council";
import { marketSchema, symbolRefSchema } from "@solyx/core/market";
import {
  memoryBodySchema,
  memoryDescriptionSchema,
  memoryKindSchema,
} from "@solyx/core/memory";
import {
  MIN_INTERVAL_MINUTES,
  ScheduleApproval,
  ScheduleKind,
  scheduledTaskDraftSchema,
} from "@solyx/core/schedule";
import { sectorQuoteSchema } from "@solyx/core/sectors";
import { strategyChangeSchema, strategyNameSchema } from "@solyx/core/strategy";
import { themeDraftSchema } from "@solyx/core/theme";
import { isEnumValue } from "@solyx/utils/is";

import { agentModelPickSchema } from "./providers.ts";
import type { AgentModelRef, AgentThinking } from "./providers.ts";

/** How a conversation's calls that must ask get past the approval gate. */
export const ApprovalMode = {
  /** Each call waits for the user to allow it. */
  Ask: "ask",
  /**
   * A shell command the decisions model judges harmless runs, a page the conversation's own
   * searches or news found is read, and a memory is saved; every other call still asks.
   */
  Auto: "auto",
  /** Calls run without asking, shell commands included. */
  Bypass: "bypass",
} as const;

export type ApprovalMode = (typeof ApprovalMode)[keyof typeof ApprovalMode];

export const approvalModeSchema = z.enum(ApprovalMode);

/** The scheduled task that started a conversation, as it was named then. */
export interface SessionSchedule {
  id: string;
  name: string;
}

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
  /** The scheduled task that started it while nobody watched; `null` for one the user started. */
  schedule: SessionSchedule | null;
}

/** What a new conversation starts on, picked before its first message. */
export const agentSessionSetupSchema = agentModelPickSchema.extend({
  approvalMode: approvalModeSchema,
});

export type AgentSessionSetup = z.infer<typeof agentSessionSetupSchema>;

// `@` opens a code where no letter or digit precedes it, so an address is not read as one, and a
// trailing full stop is not part of it. A Chinese input method writes the full-width forms.
const MENTION = /(?<![0-9A-Za-z])[@＠]([0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)/g;

// Names as the Agent Skills format allows them.
const COMMAND = /^(\s*)([/／]([a-z0-9]+(?:-[a-z0-9]+)*))(?=\s|$)/;

/** What a leading `/name` asks the app itself to do, so no skill of that name can be asked for. */
export const AgentCommand = {
  /** Summarize the conversation's older messages; what follows the name guides the summary. */
  Compact: "compact",
} as const;

export type AgentCommand = (typeof AgentCommand)[keyof typeof AgentCommand];

/** What the grammar reads a stretch of a message as. */
export const MessagePartKind = {
  Text: "text",
  /** A leading `/name`, asking for a skill. */
  Skill: "skill",
  /** A leading `/name` that is an `AgentCommand`. */
  Command: "command",
  /** `@` and a code, naming a listing. */
  Listing: "listing",
} as const;

export type MessagePartKind =
  (typeof MessagePartKind)[keyof typeof MessagePartKind];

export type MessagePart =
  | { kind: typeof MessagePartKind.Text; text: string }
  | { kind: typeof MessagePartKind.Skill; text: string; name: string }
  | { kind: typeof MessagePartKind.Command; text: string; name: AgentCommand }
  | { kind: typeof MessagePartKind.Listing; text: string; code: string };

/**
 * A message cut, in order, into its text and what it names: the skill or command a leading
 * `/name` asks for and each code `@` marks, upper-cased. Whether they name a skill or a listing the app knows is
 * for whoever reads them to resolve.
 */
export function messageParts(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  const command = COMMAND.exec(text);

  let at = 0;

  const plain = (end: number) => {
    if (end > at)
      parts.push({ kind: MessagePartKind.Text, text: text.slice(at, end) });
  };

  if (command) {
    const [, space, token, name] = command;

    parts.push(
      { kind: MessagePartKind.Text, text: space },
      isEnumValue(AgentCommand, name)
        ? { kind: MessagePartKind.Command, text: token, name }
        : { kind: MessagePartKind.Skill, text: token, name }
    );
    at = command[0].length;
  }

  // A `/name` holds no `@`, so every mention lies past it.
  for (const mention of text.matchAll(MENTION)) {
    plain(mention.index);
    parts.push({
      kind: MessagePartKind.Listing,
      text: mention[0],
      code: mention[1].toUpperCase(),
    });
    at = mention.index + mention[0].length;
  }

  plain(text.length);

  return parts.filter((part) => part.text !== "");
}

/** The skill a message asks for and the codes it names, each once. */
export function messageTokens(text: string) {
  const parts = messageParts(text);

  return {
    skill: parts.flatMap((part) =>
      part.kind === MessagePartKind.Skill ? [part.name] : []
    )[0],
    codes: uniq(
      parts.flatMap((part) =>
        part.kind === MessagePartKind.Listing ? [part.code] : []
      )
    ),
  };
}

/** The command a message starts with, and what follows its name. */
export function messageCommand(text: string) {
  const command = COMMAND.exec(text);

  if (!command) return undefined;

  const [whole, , , name] = command;

  return isEnumValue(AgentCommand, name)
    ? { command: name, rest: text.slice(whole.length).trim() }
    : undefined;
}

/** The agent's tools, which the renderer labels and whose `details` it narrows by name. */
export const AgentToolName = {
  GetMarketStatus: "get_market_status",
  GetCandles: "get_candles",
  GetIndicators: "get_indicators",
  GetNews: "get_news",
  GetHeadlines: "get_headlines",
  GetWatchlist: "get_watchlist",
  GetCalendar: "get_calendar",
  GetAccount: "get_account",
  GetQuotes: "get_quotes",
  ListProposals: "list_proposals",
  CheckOrder: "check_order",
  ProposeOrder: "propose_order",
  ProposeExit: "propose_exit",
  ReadSkill: "read_skill",
  ToolSearch: "tool_search",
  RunAnalysis: "run_analysis",
  Codemode: "codemode",
  WebSearch: "web_search",
  ReadPage: "read_page",
  Recall: "recall",
  Remember: "remember",
  Forget: "forget",
  GetResearch: "get_research",
  GetFundamentals: "get_fundamentals",
  GetBaseRates: "get_base_rates",
  GetFlows: "get_flows",
  GetMacro: "get_macro",
  GetSectors: "get_sectors",
  GetSectorMovers: "get_sector_movers",
  GetRotation: "get_rotation",
  ReviseReport: "revise_report",
  SubmitForecast: "submit_forecast",
  SearchHistory: "search_history",
  GetThemes: "get_themes",
  SaveTheme: "save_theme",
  SearchTheme: "search_theme",
  GetTasks: "get_tasks",
  GetTaskRuns: "get_task_runs",
  SaveTask: "save_task",
  RunTask: "run_task",
  ChangeWatchlist: "change_watchlist",
  GetSetup: "get_setup",
  ChangeSetting: "change_setting",
  GetStrategy: "get_strategy",
  AllowStrategy: "allow_strategy",
  SaveStrategy: "save_strategy",
  GetRuntimes: "get_runtimes",
  /** pi-durable's name for the shell tool, whatever shell runs it. */
  Bash: "bash",
} as const;

export type AgentToolName = (typeof AgentToolName)[keyof typeof AgentToolName];

export const getStrategyArgumentsSchema = z.object({
  name: z
    .string()
    .describe("The strategy's name, as its folder and the prompt give it"),
});

export const allowStrategyArgumentsSchema = getStrategyArgumentsSchema.extend({
  version: z
    .string()
    .describe("The version get_strategy gave, which the files must still be"),
});

export type AllowStrategyArguments = z.infer<
  typeof allowStrategyArgumentsSchema
>;

export const saveStrategyArgumentsSchema = strategyChangeSchema.extend({
  name: strategyNameSchema.describe(
    "The strategy's name, its folder's: lowercase letters, digits and single hyphens"
  ),
  version: z
    .string()
    .optional()
    .describe(
      "The version get_strategy gave, to change a strategy the files must still be; left out for a new one"
    ),
  files: strategyChangeSchema.shape.files.describe(
    "Each file to write whole, by its path from the strategy's folder: STRATEGY.md and the code for a new one, only those that change for another"
  ),
  remove: strategyChangeSchema.shape.remove.describe(
    "Files to remove, by their paths from the strategy's folder"
  ),
});

export type SaveStrategyArguments = z.infer<typeof saveStrategyArgumentsSchema>;

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

/** What a forecast's call left: the forecast, unless the call was refused. */
export const submitForecastDetailsSchema = z.object({
  symbol: symbolRefSchema,
  forecastId: z.string().optional(),
});

export type SubmitForecastDetails = z.infer<typeof submitForecastDetailsSchema>;

/** The sectors a call read, so its thread maps them as the agent saw them. */
export const getSectorsDetailsSchema = z.object({
  sectors: z.array(sectorQuoteSchema),
});

export type GetSectorsDetails = z.infer<typeof getSectorsDetailsSchema>;

/** The arguments of the tools that run a script the agent wrote. */
export const scriptArgumentsSchema = z.object({
  code: z.string().min(1).describe("The body of an async function"),
});

/** The most single backtests a script's call keeps, so the thread can open each in the backtest panel. */
export const MAX_RAN_BACKTESTS = 20;

/** A single backtest a script ran with `backtest.rules`, as it asked for it. */
export const ranBacktestSchema = z.object({
  symbol: symbolRefSchema,
  interval: intervalSchema,
  since: z.string().optional(),
  strategy: ruleStrategySchema,
  capital: z.number().optional(),
  costs: tradeCostsSchema.partial().optional(),
  split: z
    .union([z.object({ day: z.string() }), z.object({ share: z.number() })])
    .optional(),
});

export type RanBacktest = z.infer<typeof ranBacktestSchema>;

export const runAnalysisDetailsSchema = z.object({
  /** What the script printed and returned, or how it failed. */
  output: z.string(),
  /** The different single backtests it ran, in the order it ran them. */
  backtests: z.array(ranBacktestSchema).max(MAX_RAN_BACKTESTS).optional(),
});

export type RunAnalysisDetails = z.infer<typeof runAnalysisDetailsSchema>;

export const bashArgumentsSchema = z.object({ command: z.string() });

export const readPageArgumentsSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).describe("The page's full address"),
});

/** A theme the agent writes, or writes again whole under its id, once the user allows it. */
export const saveThemeArgumentsSchema = themeDraftSchema.extend({
  id: z
    .string()
    .optional()
    .describe(
      "A theme's id from get_themes, to write it again whole; left out, a new theme is kept"
    ),
  title: themeDraftSchema.shape.title.describe(
    "What is being watched, in a few words"
  ),
  thesis: themeDraftSchema.shape.thesis.describe(
    "Why it may come to matter to what the user holds, in a few sentences, in their language"
  ),
  queries: themeDraftSchema.shape.queries.describe(
    "What the app's daily news search asks for: a few words each, one per language the topic's news is written in"
  ),
  signposts: themeDraftSchema.shape.signposts.describe(
    "What would show it coming closer, each one thing that happens and that a headline could state, such as a port suspending operations"
  ),
  listings: themeDraftSchema.shape.listings.describe(
    "The listings it could reach, each with how; leave empty when none is clear yet"
  ),
});

/**
 * A scheduled task the agent writes, or writes again whole under its id, once the user allows it.
 * How it recurs is flat here, since models fill one object more surely than a choice of shapes;
 * `taskSchedule` reads it as the schedule it names.
 */
export const saveTaskArgumentsSchema = z.object({
  id: z
    .string()
    .optional()
    .describe(
      "A task's id from get_tasks, to write it again whole; left out, a new task is kept"
    ),
  name: scheduledTaskDraftSchema.shape.name.describe(
    "What the task is for, in a few words, in the user's language"
  ),
  prompt: scheduledTaskDraftSchema.shape.prompt.describe(
    "The message each run is sent, written as the user would send it and whole without this conversation, which a run never reads; a leading /name asks for a skill"
  ),
  when: z
    .enum(ScheduleKind)
    .describe(
      "interval: again every so many minutes. fixed-time: at one time of day. on-change: once something the app watches changed, of the kinds, listings and themes changeKinds, listings and themes name"
    ),
  everyMinutes: z
    .number()
    .int()
    .optional()
    .describe(
      `For interval, the span between runs; for on-change, the shortest span between two runs. From ${MIN_INTERVAL_MINUTES} minutes to a week`
    ),
  time: z
    .string()
    .optional()
    .describe(
      "For fixed-time, the time of day as HH:MM on the user's own clock, which the context gives"
    ),
  tradingDaysOf: marketSchema
    .nullable()
    .default(null)
    .describe(
      "For fixed-time, the market whose trading days it keeps to, read on the exchange's calendar; null runs every day"
    ),
  changeKinds: changeScopeSchema.shape.kinds
    .default([...EVERY_CHANGE.kinds])
    .describe(
      "For on-change, the kinds of change it runs for. falsifier-met: news may state one of a report's falsifiers. event-passed: the day of a report's event went by. signpost-met: news may state one of a theme's signposts"
    ),
  listings: changeScopeSchema.shape.listings
    .default(null)
    .describe(
      "For on-change, the listings whose reports it watches, each with its market; null for every listing the user holds and watches as each run finds them"
    ),
  themes: changeScopeSchema.shape.themes
    .default(null)
    .describe(
      "For on-change, the ids of the themes from get_themes whose signposts it watches; null for every theme"
    ),
  approval: z
    .enum(ScheduleApproval)
    .default(ScheduleApproval.Auto)
    .describe(
      "How a run nobody watches gets past a call that must ask. auto: a page its own searches found is read, a shell command judged harmless runs and a memory is saved, and the rest waits for the user. ask: every such call waits, so the run rests at the first"
    ),
  enabled: z
    .boolean()
    .default(true)
    .describe("False keeps the task without running it"),
});

export type SaveTaskArguments = z.infer<typeof saveTaskArgumentsSchema>;

/** The schedule a task's arguments name, for `scheduleSchema` to check: a part its kind needs may still be missing. */
export function taskSchedule({
  when,
  everyMinutes,
  time,
  tradingDaysOf,
  changeKinds,
  listings,
  themes,
}: Omit<SaveTaskArguments, "id" | "name" | "prompt" | "approval" | "enabled">) {
  switch (when) {
    case ScheduleKind.Interval:
      return { kind: when, everyMinutes };
    case ScheduleKind.OnChange:
      return {
        kind: when,
        atMostEveryMinutes: everyMinutes,
        scope: { kinds: changeKinds, listings, themes },
      };
    case ScheduleKind.FixedTime:
      return { kind: when, time, tradingDaysOf };
  }
}

// As many as a reply would reasonably name; more is a list to write by hand.
const WATCHLIST_CHANGES = 20;

/** Listings the agent adds to the user's watchlist and takes off it, once the user allows it. */
export const changeWatchlistArgumentsSchema = z.object({
  add: z
    .array(symbolRefSchema)
    .max(WATCHLIST_CHANGES)
    .default([])
    .describe("Listings to start watching, each with its market"),
  remove: z
    .array(symbolRefSchema)
    .max(WATCHLIST_CHANGES)
    .default([])
    .describe("Watched listings to stop watching"),
});

/** A memory the agent saves, or rewrites whole under its id. */
export const rememberArgumentsSchema = z.object({
  id: z
    .string()
    .optional()
    .describe(
      "A memory's id from the list, to rewrite it whole; left out, a new memory is saved"
    ),
  kind: memoryKindSchema.describe(
    "profile: who the user is, their goals and limits, and how they trade; feedback: how they want you to work; note: a thesis or fact worth keeping"
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
  distinct: z
    .boolean()
    .default(false)
    .describe(
      "True to save a new memory the app read as one already kept, once you checked that it holds something that one does not"
    ),
});

export const runTaskArgumentsSchema = z.object({
  id: z.string().describe("A task's id from get_tasks"),
});

export const forgetArgumentsSchema = z.object({
  id: z.string().describe("A memory's id from the list"),
});

/** A setting the agent changes once the user allows it, as the user reads it before they do. */
export const changeSettingArgumentsSchema = z.object({
  setting: z
    .string()
    .describe(
      "The setting's name as get_setup gives it, such as agent.thinking"
    ),
  value: z.string().describe("A value get_setup says the setting takes"),
});

export type SettingChange = z.infer<typeof changeSettingArgumentsSchema>;

export const AgentEventType = {
  RunStart: "run:start",
  User: "user",
  AssistantStart: "assistant:start",
  AssistantDelta: "assistant:delta",
  AssistantEnd: "assistant:end",
  /** The reply streaming began a call, whose arguments the model is still writing. */
  ToolDraft: "tool:draft",
  ToolStart: "tool:start",
  ToolEnd: "tool:end",
  ApprovalRequest: "approval:request",
  ApprovalResolved: "approval:resolved",
  RunEnd: "run:end",
  /**
   * The app quit or crashed as often as pi-durable allows while the run went, without it getting
   * further, so it waits until the user tries it again or stops it.
   */
  RunParked: "run:parked",
  /** The user tried a parked run again, which goes on from where it stopped. */
  RunRetried: "run:retried",
  /** What the conversation's next request holds, which changes with every message. */
  Context: "context",
  CompactionStart: "compaction:start",
  CompactionEnd: "compaction:end",
  /** A summary took the place of the older messages in what the model reads. */
  Compacted: "compacted",
} as const;

export type AgentEventType =
  (typeof AgentEventType)[keyof typeof AgentEventType];

export const DeltaChannel = {
  Text: "text",
  Thinking: "thinking",
} as const;

export type DeltaChannel = (typeof DeltaChannel)[keyof typeof DeltaChannel];

export const ToolCallStatus = {
  /** The model is still writing the call's arguments, such as a report it files through it. */
  Drafting: "drafting",
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

/** How a call a script made ended, as pi-durable's code mode tells it. */
export const ScriptCallStatus = {
  Running: "running",
  Ok: "ok",
  Error: "error",
  /** Still running when the script ended. */
  Cancelled: "cancelled",
} as const;

export type ScriptCallStatus =
  (typeof ScriptCallStatus)[keyof typeof ScriptCallStatus];

/** A call's arguments from the compact JSON kept of them, or that text where it was cut short. */
const shownArgumentsSchema = z.string().transform((text) => {
  try {
    return z.json().parse(JSON.parse(text));
  } catch {
    return text;
  }
});

/**
 * The details of a `codemode` call once it ended: the tool calls its script made, which a
 * transcript read from storage shows under it. The shape is pi-durable's `CodemodeToolDetails`.
 */
export const codemodeDetailsSchema = z.object({
  calls: z.array(
    z.object({
      /** The script's own number for the call, whose id is `<the script's call id>/c<id>`. */
      id: z.number(),
      name: z.string(),
      args: shownArgumentsSchema,
      status: z.enum(ScriptCallStatus),
      error: z.string().optional(),
    })
  ),
});

export type CodemodeDetails = z.infer<typeof codemodeDetailsSchema>;

export const RunEndReason = {
  Done: "done",
  Aborted: "aborted",
  Error: "error",
  /** The app exited mid-run, so the transcript stops short. */
  Interrupted: "interrupted",
  /** The conversations' store failed mid-run; the run carries on once the app starts again. */
  StoreFailed: "store-failed",
} as const;

export type RunEndReason = (typeof RunEndReason)[keyof typeof RunEndReason];

/**
 * A reply's request and answer in tokens, as its provider counted them. The request's prompt is
 * `input`, `cacheRead` and `cacheWrite` together.
 */
export interface ReplyUsage {
  /** Prompt tokens the provider's cache neither served nor stored. */
  input: number;
  /** Prompt tokens the provider's prompt cache served. */
  cacheRead: number;
  /** Prompt tokens stored in the provider's prompt cache for the requests that follow. */
  cacheWrite: number;
  output: number;
}

/** How a compaction the user asked for ended. */
export const CompactionOutcome = {
  Summarized: "summarized",
  /** Every message is recent enough to keep as it is. */
  NothingOld: "nothing-old",
  Stopped: "stopped",
} as const;

export type CompactionOutcome =
  (typeof CompactionOutcome)[keyof typeof CompactionOutcome];

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
      /** Absent for a reply that failed or was cut short, whose count stands for no whole request. */
      usage?: ReplyUsage;
    }
  | {
      type: typeof AgentEventType.ToolDraft;
      toolCallId: string;
      toolName: string;
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
        | typeof ToolCallStatus.Drafting
        | typeof ToolCallStatus.Running
        | typeof ToolCallStatus.AwaitingApproval
      >;
      /** The first line of what a failed call returned. */
      error?: string;
      /** The tool's own view model, which the renderer narrows by tool name. */
      details?: unknown;
      /** What a shell command or a script printed, as much of it as the model was given. */
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
    }
  | { type: typeof AgentEventType.RunParked }
  | { type: typeof AgentEventType.RunRetried }
  | {
      type: typeof AgentEventType.Context;
      /** As pi estimates it: the latest reply's count, and what followed it guessed from its length. */
      tokens: number;
    }
  | {
      type: typeof AgentEventType.CompactionStart;
      id: string;
      /** The user asked for it; otherwise the context grew past its threshold. */
      manual: boolean;
    }
  | { type: typeof AgentEventType.CompactionEnd; id: string }
  | {
      type: typeof AgentEventType.Compacted;
      messageId: string;
      summary: string;
      at: number;
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
  Compaction: "compaction",
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
  usage?: ReplyUsage;
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

/** Where a summary took the place of the messages before it, which stay in the thread. */
export interface CompactionView {
  kind: typeof AgentItemKind.Compaction;
  messageId: string;
  summary: string;
  /** Epoch ms. */
  at: number;
}

export type AgentViewItem =
  | MessageView
  | ToolCallView
  | NoticeView
  | CompactionView;

export interface AgentView {
  items: AgentViewItem[];
  running: boolean;
  /** The run waits for the user to try it again or stop it; see `RunParked`. */
  parked: boolean;
  /** Tokens the next request holds; unset until the conversation holds a message. */
  context?: number;
  /** Compactions under way. */
  compactions: { id: string; manual: boolean }[];
}

export const emptyAgentView = (): AgentView => ({
  items: [],
  running: false,
  parked: false,
  compactions: [],
});

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
      return { ...view, items, running: true, parked: false };

    case AgentEventType.User:
      items.push({
        kind: AgentItemKind.User,
        messageId: event.messageId,
        text: event.text,
        at: event.at,
        streaming: false,
      });

      return { ...view, items };

    case AgentEventType.AssistantStart: {
      // Every call a reply drafted starts before the next reply does, so one still drafted was
      // drafted by an attempt that was given up.
      const kept = items.filter(
        (item) =>
          item.kind !== AgentItemKind.Tool ||
          item.status !== ToolCallStatus.Drafting
      );

      kept.push({
        kind: AgentItemKind.Assistant,
        messageId: event.messageId,
        text: "",
        streaming: true,
      });

      return { ...view, items: kept };
    }

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
        usage: event.usage,
      };

      if (index === -1) items.push(message);
      else items[index] = message;

      return { ...view, items };
    }

    case AgentEventType.ToolDraft:
      if (findTool(event.toolCallId) !== -1) return view;

      items.push({
        kind: AgentItemKind.Tool,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: undefined,
        status: ToolCallStatus.Drafting,
      });

      return { ...view, items };

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

      // A resumed round may start a call the replayed transcript already shows, and a drafted call
      // starts where it was drafted.
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
          (item.status === ToolCallStatus.Drafting ||
            item.status === ToolCallStatus.Running ||
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

      return { ...view, items: settled, running: false, parked: false };
    }

    case AgentEventType.RunParked:
      return { ...view, parked: true };

    case AgentEventType.RunRetried:
      return { ...view, parked: false };

    case AgentEventType.Context:
      return { ...view, context: event.tokens };

    case AgentEventType.CompactionStart:
      return view.compactions.some((each) => each.id === event.id)
        ? view
        : {
            ...view,
            compactions: [
              ...view.compactions,
              { id: event.id, manual: event.manual },
            ],
          };

    case AgentEventType.CompactionEnd:
      return {
        ...view,
        compactions: view.compactions.filter((each) => each.id !== event.id),
      };

    case AgentEventType.Compacted:
      if (
        items.some(
          (item) =>
            item.kind === AgentItemKind.Compaction &&
            item.messageId === event.messageId
        )
      ) {
        return view;
      }

      items.push({
        kind: AgentItemKind.Compaction,
        messageId: event.messageId,
        summary: event.summary,
        at: event.at,
      });

      return { ...view, items };

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
