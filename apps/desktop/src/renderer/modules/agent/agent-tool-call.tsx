import { Spinner, cn } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { AgentToolName, ToolCallStatus } from "@solyx/agent/wire";
import type { ToolCallView } from "@solyx/agent/wire";
import { intervalSchema } from "@solyx/core/candles";
import { marketSchema, symbolRefSchema } from "@solyx/core/market";
import { isEnumValue } from "@solyx/utils/is";

import { ProposalItem } from "../proposals/proposal-item.tsx";
import { proposalsQuery } from "../proposals/proposals-query.ts";

// Only the fields a row names; the model's arguments are not trusted to hold them.
const argumentsSchema = z.object({
  symbol: symbolRefSchema.optional(),
  interval: intervalSchema.optional(),
  order: z.object({ market: marketSchema, symbol: z.string() }).optional(),
  name: z.string().optional(),
});

const proposalDetailsSchema = z.object({ proposalId: z.string() });

/** What a call was about: a listing and its interval, an order's listing, or a playbook. */
function subjectOf(tool: ToolCallView): string | undefined {
  const args = argumentsSchema.safeParse(tool.args).data;

  if (args?.symbol) {
    const listing = `${args.symbol.market} ${args.symbol.symbol}`;

    return args.interval ? `${listing} · ${args.interval}` : listing;
  }

  if (args?.order) return `${args.order.market} ${args.order.symbol}`;

  return args?.name;
}

const STATUS_MARK: Record<ToolCallStatus, string> = {
  [ToolCallStatus.Running]: "",
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

export function AgentToolCall({ tool }: { tool: ToolCallView }) {
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
      {proposal ? <ProposalCard id={proposal.proposalId} /> : null}
    </div>
  );
}
