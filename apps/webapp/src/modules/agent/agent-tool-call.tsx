import type { ReactNode } from "react";

import { Button, Disclosure, Spinner, cn } from "@heroui/react";
import {
  Cancel01Icon,
  Clock01Icon,
  MinusSignIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import {
  AgentToolName,
  ToolCallStatus,
  allowStrategyArgumentsSchema,
  bashArgumentsSchema,
  changeSettingArgumentsSchema,
  changeWatchlistArgumentsSchema,
  forgetArgumentsSchema,
  getSectorsDetailsSchema,
  proposeOrderDetailsSchema,
  readPageArgumentsSchema,
  rememberArgumentsSchema,
  runTaskArgumentsSchema,
  saveStrategyArgumentsSchema,
  saveTaskArgumentsSchema,
  saveThemeArgumentsSchema,
  runAnalysisDetailsSchema,
  scriptArgumentsSchema,
  submitForecastDetailsSchema,
  taskSchedule,
} from "@solyx/agent/wire";
import type { ToolCallView } from "@solyx/agent/wire";
import { intervalSchema } from "@solyx/core/candles";
import {
  marketSchema,
  symbolKey,
  symbolRefSchema,
  symbolLabel,
} from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { Memory } from "@solyx/core/memory";
import { ScheduleKind, scheduleSchema } from "@solyx/core/schedule";
import type { ScheduledTaskDraft } from "@solyx/core/schedule";
import type { ThemeDraft } from "@solyx/core/theme";
import { isEnumValue } from "@solyx/utils/is";

import { useClock } from "../../app/clock.ts";
import { inWindow } from "../../app/device.ts";
import { client } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { Icon } from "../../components/icon.tsx";
import { RanBacktests } from "../backtests/agent-bridge.tsx";
import { ListingName } from "../market/listing-name.tsx";
import { SectorMap } from "../market/sector-heat-map.tsx";
import { memoryQuery } from "../memory/memory-query.ts";
import { ProposalItem } from "../proposals/proposal-item.tsx";
import { proposalsQuery } from "../proposals/proposals-query.ts";
import { ForecastCard } from "../research/forecast-card.tsx";
import { useScopeText } from "../schedules/change-scope-fields.tsx";
import { schedulesQuery } from "../schedules/schedules-query.ts";
import { scheduleText } from "../schedules/timing-fields.tsx";
import { codeExecutionQuery } from "../settings/settings-query.ts";
import {
  StrategyChanges,
  StrategyDraftChanges,
  shortVersion,
} from "../strategies/strategy-changes.tsx";

import { ActivityMark } from "./agent-activity.tsx";
import { MagiPanel } from "./magi-panel.tsx";

/** Shorter than the overview's, since the pane is narrower and the reply follows. */
const SECTOR_MAP_HEIGHT = 240;

// Only the fields a row names; the model's arguments are not trusted to hold them.
const argumentsSchema = z.object({
  symbol: symbolRefSchema.optional(),
  interval: intervalSchema.optional(),
  order: z.object({ market: marketSchema, symbol: z.string() }).optional(),
  instrument: z.object({ market: marketSchema, symbol: z.string() }).optional(),
  name: z.string().optional(),
  query: z.string().optional(),
  url: z.string().optional(),
  description: z.string().optional(),
  setting: z.string().optional(),
});

/**
 * What a call was about: a listing and its interval, an order's or a forecast's listing, a
 * playbook, a search, a page, a memory or a setting.
 */
function Subject({ tool }: { tool: ToolCallView }) {
  const { t } = useTranslation();
  const args = argumentsSchema.safeParse(tool.args).data;
  const listing = args?.symbol ?? args?.order ?? args?.instrument;

  if (listing) {
    const symbol = { market: listing.market, symbol: listing.symbol };

    return (
      <span className="flex min-w-0 items-center gap-1">
        <span className="shrink-0">{symbol.symbol}</span>
        <ListingName symbol={symbol} />
        {args?.interval ? (
          <span className="shrink-0">
            · {t(`chart.intervals.${args.interval}`)}
          </span>
        ) : null}
      </span>
    );
  }

  const text =
    args?.name ??
    args?.query ??
    args?.url ??
    args?.description ??
    args?.setting;

  return text ? <span className="min-w-0 truncate">{text}</span> : null;
}

function StatusIcon({ status }: { status: ToolCallStatus }) {
  switch (status) {
    case ToolCallStatus.Running:
      return <Spinner size="sm" color="current" className="size-3" />;
    case ToolCallStatus.AwaitingApproval:
      return <Icon icon={Clock01Icon} className="size-3" />;
    case ToolCallStatus.Ok:
      return <Icon icon={Tick02Icon} className="size-3" />;
    case ToolCallStatus.Error:
      return <Icon icon={Cancel01Icon} className="size-3" />;
    default:
      return <Icon icon={MinusSignIcon} className="size-3" />;
  }
}

/** The proposal the call made, as the queue shows it, so it can be confirmed where it was made. */
function ProposalCard({ id }: { id: string }) {
  const { data } = useQuery(proposalsQuery());
  const proposal = data?.find((candidate) => candidate.id === id);

  return proposal ? <ProposalItem proposal={proposal} /> : null;
}

/** A memory the agent asks to save or forget, as the user would read it. */
function memoryChange(tool: ToolCallView, memories: readonly Memory[]) {
  if (tool.toolName === AgentToolName.Remember) {
    const memory = rememberArgumentsSchema.safeParse(tool.args).data;

    return (
      memory && [memory.description, memory.body].filter(Boolean).join("\n\n")
    );
  }

  if (tool.toolName === AgentToolName.Forget) {
    const id = forgetArgumentsSchema.safeParse(tool.args).data?.id;

    return memories.find((memory) => memory.id === id)?.description ?? id;
  }

  return undefined;
}

/** A theme the agent asks to save, as the user reads it on the themes page. */
function themeText(theme: ThemeDraft) {
  return [
    theme.title,
    theme.thesis,
    ...theme.signposts.map((signpost) => `· ${signpost}`),
    theme.queries.join(" / "),
    ...theme.listings.map(
      ({ symbol, exposure }) => `${symbolLabel(symbol)}: ${exposure}`
    ),
  ].join("\n");
}

/** A task as the schedules list it: its name, when it runs and how it asks, any `notes`, then what it sends. */
function taskText(
  t: TFunction,
  scopeText: ReturnType<typeof useScopeText>,
  task: Pick<
    ScheduledTaskDraft,
    "name" | "schedule" | "timeZone" | "approval" | "prompt"
  >,
  notes: readonly string[]
) {
  const { schedule } = task;

  return [
    task.name,
    scheduleText(t, schedule, task.timeZone),
    ...(schedule.kind === ScheduleKind.OnChange
      ? [scopeText(schedule.scope)]
      : []),
    t(`settings.schedules.approvals.${task.approval}`),
    ...notes,
    "",
    task.prompt,
  ].join("\n");
}

/** Listings the agent asks to add to or take off the watchlist, each by its name too. */
function WatchlistChange({
  add,
  remove,
}: {
  add: readonly SymbolRef[];
  remove: readonly SymbolRef[];
}) {
  return (
    <>
      {[
        ...add.map((symbol) => ({ sign: "+", symbol })),
        ...remove.map((symbol) => ({ sign: "−", symbol })),
      ].map(({ sign, symbol }) => (
        <span key={`${sign}${symbolKey(symbol)}`} className="flex gap-1">
          {sign} {symbol.market} {symbol.symbol}
          <ListingName symbol={symbol} />
        </span>
      ))}
    </>
  );
}

/**
 * What the card says a shell command reaches: a command runs with the user's access unless the
 * sandbox is on and can start, which only a window may read, so anywhere else it says so.
 */
function useShellDescription(enabled: boolean) {
  const { t } = useTranslation();

  const { data, isFetching } = useQuery({
    ...codeExecutionQuery(),
    enabled: enabled && inWindow,
  });

  // A settings change refetches it, and until then what it held may no longer hold.
  const sandboxed =
    !isFetching &&
    data?.sandbox.supported === true &&
    data.sandbox.enabled &&
    data.sandbox.problems.length === 0;

  return t(
    sandboxed
      ? "agent.approval.shell-description"
      : "agent.approval.shell-description-unsandboxed"
  );
}

/** What a call that waits for the user says it would do. */
interface ApprovalRequest {
  description: string;
  body: ReactNode;
  /** What to read before allowing it, such as what it changes in a strategy's files. */
  review?: ReactNode;
}

/**
 * What a call to allow or save a strategy would let run, with the files it would let run beside the
 * version allowed before; `undefined` where its arguments do not parse.
 */
function strategyRequest(
  t: TFunction,
  tool: ToolCallView
): ApprovalRequest | undefined {
  const allowing =
    tool.toolName === AgentToolName.AllowStrategy
      ? allowStrategyArgumentsSchema.safeParse(tool.args).data
      : undefined;

  if (allowing) {
    return {
      description: t("agent.approval.allow-strategy-description", {
        name: allowing.name,
      }),
      body: `${allowing.name} · ${shortVersion(allowing.version)}`,
      review: (
        <StrategyChanges name={allowing.name} version={allowing.version} />
      ),
    };
  }

  const saving =
    tool.toolName === AgentToolName.SaveStrategy
      ? saveStrategyArgumentsSchema.safeParse(tool.args).data
      : undefined;

  if (!saving) return undefined;

  return {
    description: t(
      saving.version
        ? "agent.approval.save-strategy-change-description"
        : "agent.approval.save-strategy-description",
      { name: saving.name }
    ),
    body: saving.version
      ? `${saving.name} · ${shortVersion(saving.version)}`
      : saving.name,
    review: <StrategyDraftChanges saving={saving} />,
  };
}

/**
 * What a call that waits for the user is about to do: a sentence saying so, and what it sends as
 * the user would read it. A shell command is shown whole, as the user would type it, a page by its
 * address, a setting with the value it would take and a memory as the agent wrote it; a call whose
 * arguments do not parse shows them as sent.
 */
function useApprovalRequest(tool: ToolCallView): ApprovalRequest {
  const { t } = useTranslation();
  const { timeZone } = useClock();
  const scopeText = useScopeText();

  // Forgetting names a memory by its id, which the card shows by its description.
  const memories = useQuery({
    ...memoryQuery(),
    enabled: tool.toolName === AgentToolName.Forget,
  });

  const run =
    tool.toolName === AgentToolName.RunTask
      ? runTaskArgumentsSchema.safeParse(tool.args).data
      : undefined;

  // The call names a task by its id, which the card shows as the user wrote it.
  const tasks = useQuery({ ...schedulesQuery(), enabled: run !== undefined });

  const shellDescription = useShellDescription(
    tool.toolName === AgentToolName.Bash
  );

  switch (tool.toolName) {
    case AgentToolName.Bash: {
      const command = bashArgumentsSchema.safeParse(tool.args).data?.command;

      if (command !== undefined) {
        return {
          description: shellDescription,
          body: command,
        };
      }

      break;
    }

    case AgentToolName.ReadPage: {
      const address = readPageArgumentsSchema.safeParse(tool.args).data?.url;

      if (address !== undefined) {
        return {
          description: t("agent.approval.read-page-description"),
          body: address,
        };
      }

      break;
    }

    case AgentToolName.ChangeSetting: {
      const change = changeSettingArgumentsSchema.safeParse(tool.args).data;

      if (change) {
        return {
          description: t("agent.approval.change-setting-description"),
          body: `${change.setting} → ${change.value}`,
        };
      }

      break;
    }

    case AgentToolName.SaveTheme: {
      const theme = saveThemeArgumentsSchema.safeParse(tool.args).data;

      if (theme) {
        return {
          description: t("agent.approval.save-theme-description"),
          body: themeText(theme),
        };
      }

      break;
    }

    case AgentToolName.SaveTask: {
      const task = saveTaskArgumentsSchema.safeParse(tool.args).data;
      // A part the kind needs may be missing, which the call is refused for before it asks.
      const timed = task && scheduleSchema.safeParse(taskSchedule(task)).data;

      if (task && timed) {
        return {
          description: t("agent.approval.save-task-description"),
          body: taskText(
            t,
            scopeText,
            { ...task, schedule: timed, timeZone },
            task.enabled ? [] : [t("agent.approval.save-task-off")]
          ),
        };
      }

      break;
    }

    case AgentToolName.RunTask: {
      if (!run) break;

      const due = tasks.data?.find((each) => each.id === run.id);

      return {
        description: t("agent.approval.run-task-description"),
        body: due ? taskText(t, scopeText, due, []) : run.id,
      };
    }

    case AgentToolName.ChangeWatchlist: {
      const listings = changeWatchlistArgumentsSchema.safeParse(tool.args).data;

      if (listings) {
        return {
          description: t("agent.approval.change-watchlist-description"),
          body: <WatchlistChange add={listings.add} remove={listings.remove} />,
        };
      }

      break;
    }

    case AgentToolName.AllowStrategy:
    case AgentToolName.SaveStrategy: {
      const request = strategyRequest(t, tool);

      if (request) return request;

      break;
    }

    case AgentToolName.Remember:
    case AgentToolName.Forget: {
      const memory = memoryChange(tool, memories.data ?? []);

      if (memory !== undefined) {
        return {
          description: t(
            tool.toolName === AgentToolName.Forget
              ? "agent.approval.forget-description"
              : "agent.approval.remember-description"
          ),
          body: memory,
        };
      }

      break;
    }
  }

  return {
    description: t("agent.approval.description", { tool: tool.toolName }),
    body: JSON.stringify(tool.args, null, 2),
  };
}

/**
 * A call that waits for the user, with what it is about to send. Neither answer is ink: only
 * confirming a proposal makes anything real.
 */
function ApprovalCard({
  sessionId,
  tool,
}: {
  sessionId: string;
  tool: ToolCallView;
}) {
  const { t } = useTranslation();
  const { description, body, review } = useApprovalRequest(tool);

  const answer = useMutation({
    mutationFn: (approved: boolean) =>
      client.agent.approve({
        id: sessionId,
        toolCallId: tool.toolCallId,
        approved,
      }),
  });

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-dashed border-separator p-3">
      <p className="text-sm font-medium">{t("agent.approval.title")}</p>
      <p className="text-xs text-muted">{description}</p>
      <pre className="max-h-40 overflow-auto rounded-sm bg-surface-secondary p-2 font-mono text-xs whitespace-pre-wrap">
        {body}
      </pre>
      {review}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          isPending={answer.isPending && answer.variables}
          isDisabled={answer.isPending || !inWindow}
          onPress={() => answer.mutate(true)}>
          {t("agent.approval.allow")}
        </Button>
        <Button
          size="sm"
          variant="tertiary"
          isPending={answer.isPending && !answer.variables}
          isDisabled={answer.isPending || !inWindow}
          onPress={() => answer.mutate(false)}>
          {t("agent.approval.deny")}
        </Button>
      </div>
      {inWindow ? null : (
        <p className="text-xs text-muted">{t("devices.answer-on-computer")}</p>
      )}
      {answer.error ? (
        <ErrorAlert
          title={t("agent.approval.failed")}
          description={answer.error.message}
        />
      ) : null}
    </div>
  );
}

/** What a call ran and what it printed, folded away so the numbers can be checked. */
function CodeCard({
  label,
  code,
  output,
}: {
  label: string;
  code: string;
  output?: string;
}) {
  const { t } = useTranslation();

  return (
    <Disclosure className="pl-5.5">
      <Disclosure.Heading>
        <Disclosure.Trigger className="flex min-h-5 items-center gap-2 text-xs text-muted">
          {label}
          <Disclosure.Indicator className="size-3" />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <div className="flex flex-col gap-1.5 pt-1">
          <pre className="max-h-80 overflow-auto rounded-sm bg-surface-secondary p-2 font-mono text-xs whitespace-pre-wrap">
            {code}
          </pre>
          {output ? (
            <>
              <p className="text-xs text-muted">{t("agent.analysis.output")}</p>
              <pre className="max-h-80 overflow-auto rounded-sm bg-surface-secondary p-2 font-mono text-xs whitespace-pre-wrap">
                {output}
              </pre>
            </>
          ) : null}
        </div>
      </Disclosure.Content>
    </Disclosure>
  );
}

/** A script the agent wrote with what it printed, and the single backtests an analysis ran. */
function ScriptCard({ tool }: { tool: ToolCallView }) {
  const { t } = useTranslation();
  const code = scriptArgumentsSchema.safeParse(tool.args).data?.code;

  const details =
    tool.toolName === AgentToolName.RunAnalysis
      ? runAnalysisDetailsSchema.safeParse(tool.details).data
      : undefined;

  if (!code) return null;

  return (
    <>
      <CodeCard
        label={t("agent.analysis.code")}
        code={code}
        output={details ? details.output : tool.output}
      />
      {details?.backtests ? (
        <RanBacktests backtests={details.backtests} />
      ) : null}
    </>
  );
}

/** The script or command behind a call, for the tools that run one. */
function RanCode({ tool }: { tool: ToolCallView }) {
  const { t } = useTranslation();

  if (
    tool.toolName === AgentToolName.RunAnalysis ||
    tool.toolName === AgentToolName.Codemode
  ) {
    return <ScriptCard tool={tool} />;
  }

  // While it waits for the user, the approval card shows the command instead.
  if (
    tool.toolName === AgentToolName.Bash &&
    tool.status !== ToolCallStatus.AwaitingApproval
  ) {
    const command = bashArgumentsSchema.safeParse(tool.args).data?.command;

    return command ? (
      <CodeCard
        label={t("agent.analysis.command")}
        code={command}
        output={tool.output}
      />
    ) : null;
  }

  return null;
}

/** Why a call ran unasked in a conversation set to auto, by what its tool's check goes by. */
function autoAllowedLabel(toolName: string) {
  if (toolName === AgentToolName.ReadPage) {
    return "agent.approval.auto-allowed-found";
  }

  return toolName === AgentToolName.Remember
    ? "agent.approval.auto-allowed-memory"
    : "agent.approval.auto-allowed";
}

export function AgentToolCall({
  sessionId,
  tool,
}: {
  sessionId: string;
  tool: ToolCallView;
}) {
  const { t } = useTranslation();

  const proposal =
    (tool.toolName === AgentToolName.ProposeOrder ||
      tool.toolName === AgentToolName.ProposeExit) &&
    tool.status === ToolCallStatus.Ok
      ? proposeOrderDetailsSchema.safeParse(tool.details).data
      : undefined;

  const forecast =
    tool.toolName === AgentToolName.SubmitForecast &&
    tool.status === ToolCallStatus.Ok
      ? submitForecastDetailsSchema.safeParse(tool.details).data
      : undefined;

  // The sectors as the call read them, not as they trade now, so the map agrees with the reply.
  const sectors =
    tool.toolName === AgentToolName.GetSectors &&
    tool.status === ToolCallStatus.Ok
      ? getSectorsDetailsSchema.safeParse(tool.details).data?.sectors
      : undefined;

  // A script's calls sit under it, in line with its name.
  return (
    <div
      data-activity
      className={cn(
        "flex flex-col gap-1.5",
        tool.parentToolCallId !== undefined && "pl-5.5"
      )}>
      <div className="flex min-h-5 items-center gap-2 text-xs text-muted">
        <ActivityMark
          className={cn(tool.status === ToolCallStatus.Error && "text-danger")}>
          <StatusIcon status={tool.status} />
        </ActivityMark>
        <span className="shrink-0 text-foreground">
          {isEnumValue(AgentToolName, tool.toolName)
            ? t(`agent.tools.${tool.toolName}`)
            : tool.toolName}
        </span>
        <Subject tool={tool} />
        {tool.autoApproved ? (
          <span className="shrink-0">
            · {t(autoAllowedLabel(tool.toolName))}
          </span>
        ) : null}
        <span className="sr-only">{t(`agent.tool-status.${tool.status}`)}</span>
      </div>
      {tool.error ? (
        <p className="pl-5.5 text-xs text-danger">{tool.error}</p>
      ) : null}
      {tool.status === ToolCallStatus.AwaitingApproval ? (
        <ApprovalCard sessionId={sessionId} tool={tool} />
      ) : null}
      <RanCode tool={tool} />
      {proposal?.proposalId ? <ProposalCard id={proposal.proposalId} /> : null}
      {proposal?.council ? <MagiPanel council={proposal.council} /> : null}
      {forecast?.forecastId ? (
        <ForecastCard symbol={forecast.symbol} id={forecast.forecastId} />
      ) : null}
      {sectors ? (
        <SectorMap sectors={sectors} height={SECTOR_MAP_HEIGHT} />
      ) : null}
    </div>
  );
}
