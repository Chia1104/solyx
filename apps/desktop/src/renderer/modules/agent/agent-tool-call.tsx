import { Button, Disclosure, Spinner, cn } from "@heroui/react";
import {
  Cancel01Icon,
  Clock01Icon,
  MinusSignIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import {
  AgentToolName,
  ToolCallStatus,
  bashArgumentsSchema,
  forgetArgumentsSchema,
  proposeOrderDetailsSchema,
  readPageArgumentsSchema,
  rememberArgumentsSchema,
  runAnalysisDetailsSchema,
  runToolScriptDetailsSchema,
  scriptArgumentsSchema,
  submitForecastDetailsSchema,
} from "@solyx/agent/wire";
import type { ToolCallView } from "@solyx/agent/wire";
import { intervalSchema } from "@solyx/core/candles";
import { marketSchema, symbolRefSchema } from "@solyx/core/market";
import type { Memory } from "@solyx/core/memory";
import { isEnumValue } from "@solyx/utils/is";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { Icon } from "../../components/icon.tsx";
import { ListingName } from "../market/listing-name.tsx";
import { memoryQuery } from "../memory/memory-query.ts";
import { ProposalItem } from "../proposals/proposal-item.tsx";
import { proposalsQuery } from "../proposals/proposals-query.ts";
import { ForecastCard } from "../research/forecast-card.tsx";

import { ActivityMark } from "./agent-activity.tsx";

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
});

/**
 * What a call was about: a listing and its interval, an order's or a forecast's listing, a
 * playbook, a search, a page or a memory.
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

  const text = args?.name ?? args?.query ?? args?.url ?? args?.description;

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

  return proposal ? (
    <div className="rounded-sm border border-separator">
      <ProposalItem proposal={proposal} />
    </div>
  ) : null;
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

  const answer = useMutation({
    mutationFn: (approved: boolean) =>
      window.solyx.agent.approve(sessionId, tool.toolCallId, approved),
  });

  // Forgetting names a memory by its id, which the card shows by its description.
  const memories = useQuery({
    ...memoryQuery(),
    enabled: tool.toolName === AgentToolName.Forget,
  });

  // A shell command is shown as the user would type it, whole, a page by its address and a
  // memory as the agent wrote it.
  const command =
    tool.toolName === AgentToolName.Bash
      ? bashArgumentsSchema.safeParse(tool.args).data?.command
      : undefined;

  const address =
    tool.toolName === AgentToolName.ReadPage
      ? readPageArgumentsSchema.safeParse(tool.args).data?.url
      : undefined;

  const memory = memoryChange(tool, memories.data ?? []);

  let description = t("agent.approval.description", { tool: tool.toolName });

  if (command !== undefined) {
    description = t("agent.approval.shell-description");
  } else if (address !== undefined) {
    description = t("agent.approval.read-page-description");
  } else if (memory !== undefined) {
    description = t(
      tool.toolName === AgentToolName.Forget
        ? "agent.approval.forget-description"
        : "agent.approval.remember-description"
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-dashed border-separator p-3">
      <p className="text-sm font-medium">{t("agent.approval.title")}</p>
      <p className="text-xs text-muted">{description}</p>
      <pre className="max-h-40 overflow-auto rounded-sm bg-surface-secondary p-2 font-mono text-xs whitespace-pre-wrap">
        {command ?? address ?? memory ?? JSON.stringify(tool.args, null, 2)}
      </pre>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          isPending={answer.isPending && answer.variables}
          isDisabled={answer.isPending}
          onPress={() => answer.mutate(true)}>
          {t("agent.approval.allow")}
        </Button>
        <Button
          size="sm"
          variant="tertiary"
          isPending={answer.isPending && !answer.variables}
          isDisabled={answer.isPending}
          onPress={() => answer.mutate(false)}>
          {t("agent.approval.deny")}
        </Button>
      </div>
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

/** The script or command behind a call, for the tools that run one. */
function RanCode({ tool }: { tool: ToolCallView }) {
  const { t } = useTranslation();

  if (
    tool.toolName === AgentToolName.RunAnalysis ||
    tool.toolName === AgentToolName.RunToolScript
  ) {
    const code = scriptArgumentsSchema.safeParse(tool.args).data?.code;

    const output = (
      tool.toolName === AgentToolName.RunAnalysis
        ? runAnalysisDetailsSchema
        : runToolScriptDetailsSchema
    ).safeParse(tool.details).data?.output;

    return code ? (
      <CodeCard label={t("agent.analysis.code")} code={code} output={output} />
    ) : null;
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

export function AgentToolCall({
  sessionId,
  tool,
}: {
  sessionId: string;
  tool: ToolCallView;
}) {
  const { t } = useTranslation();

  const proposal =
    tool.toolName === AgentToolName.ProposeOrder &&
    tool.status === ToolCallStatus.Ok
      ? proposeOrderDetailsSchema.safeParse(tool.details).data
      : undefined;

  const forecast =
    tool.toolName === AgentToolName.SubmitForecast &&
    tool.status === ToolCallStatus.Ok
      ? submitForecastDetailsSchema.safeParse(tool.details).data
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
            ·{" "}
            {t(
              tool.toolName === AgentToolName.ReadPage
                ? "agent.approval.auto-allowed-found"
                : "agent.approval.auto-allowed"
            )}
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
      {proposal ? <ProposalCard id={proposal.proposalId} /> : null}
      {forecast ? (
        <ForecastCard symbol={forecast.symbol} id={forecast.forecastId} />
      ) : null}
    </div>
  );
}
