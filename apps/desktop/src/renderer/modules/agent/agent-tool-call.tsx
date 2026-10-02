import { Button, Spinner, cn } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { AgentToolName, ToolCallStatus } from "@solyx/agent/wire";
import type { ToolCallView } from "@solyx/agent/wire";
import { intervalSchema } from "@solyx/core/candles";
import { marketSchema, symbolRefSchema } from "@solyx/core/market";
import { isEnumValue } from "@solyx/utils/is";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { ProposalItem } from "../proposals/proposal-item.tsx";
import { proposalsQuery } from "../proposals/proposals-query.ts";

// Only the fields a row names; the model's arguments are not trusted to hold them.
const argumentsSchema = z.object({
  symbol: symbolRefSchema.optional(),
  interval: intervalSchema.optional(),
  order: z.object({ market: marketSchema, symbol: z.string() }).optional(),
  name: z.string().optional(),
  query: z.string().optional(),
});

const proposalDetailsSchema = z.object({ proposalId: z.string() });

/** What a call was about: a listing and its interval, an order's listing, a playbook or a search. */
function subjectOf(tool: ToolCallView): string | undefined {
  const args = argumentsSchema.safeParse(tool.args).data;

  if (args?.symbol) {
    const listing = `${args.symbol.market} ${args.symbol.symbol}`;

    return args.interval ? `${listing} · ${args.interval}` : listing;
  }

  if (args?.order) return `${args.order.market} ${args.order.symbol}`;

  return args?.name ?? args?.query;
}

const STATUS_MARK: Record<ToolCallStatus, string> = {
  [ToolCallStatus.Running]: "",
  [ToolCallStatus.AwaitingApproval]: "?",
  [ToolCallStatus.Ok]: "✓",
  [ToolCallStatus.Error]: "!",
  [ToolCallStatus.Aborted]: "–",
};

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

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-dashed border-separator p-3">
      <p className="text-sm font-medium">{t("agent.approval.title")}</p>
      <p className="text-xs text-muted">
        {t("agent.approval.description", { tool: tool.toolName })}
      </p>
      <pre className="max-h-40 overflow-auto rounded-sm bg-surface-secondary p-2 font-mono text-xs whitespace-pre-wrap">
        {JSON.stringify(tool.args, null, 2)}
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

export function AgentToolCall({
  sessionId,
  tool,
}: {
  sessionId: string;
  tool: ToolCallView;
}) {
  const { t } = useTranslation();
  const subject = subjectOf(tool);

  const proposal =
    tool.toolName === AgentToolName.ProposeOrder &&
    tool.status === ToolCallStatus.Ok
      ? proposalDetailsSchema.safeParse(tool.details).data
      : undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span
          aria-hidden
          className={cn(
            "grid size-4 shrink-0 place-items-center",
            tool.status === ToolCallStatus.Error && "text-danger"
          )}>
          {tool.status === ToolCallStatus.Running ? (
            <Spinner size="sm" />
          ) : (
            STATUS_MARK[tool.status]
          )}
        </span>
        <span className="text-foreground">
          {isEnumValue(AgentToolName, tool.toolName)
            ? t(`agent.tools.${tool.toolName}`)
            : tool.toolName}
        </span>
        {subject ? <span className="truncate">{subject}</span> : null}
        <span className="sr-only">{t(`agent.tool-status.${tool.status}`)}</span>
      </div>
      {tool.error ? (
        <p className="pl-6 text-xs text-danger">{tool.error}</p>
      ) : null}
      {tool.status === ToolCallStatus.AwaitingApproval ? (
        <ApprovalCard sessionId={sessionId} tool={tool} />
      ) : null}
      {proposal ? <ProposalCard id={proposal.proposalId} /> : null}
    </div>
  );
}
