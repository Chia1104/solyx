import { Alert, Button, Chip, cn } from "@heroui/react";
import type { ChipProps } from "@heroui/react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { OrderType } from "@solyx/core/order";
import { ProposalStatus, SubmissionFailureCode } from "@solyx/core/order-desk";
import type { TradeProposal } from "@solyx/core/order-desk";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { ListingName } from "../market/listing-name.tsx";

import { violationMessage } from "./violation-message.ts";

const STATUS_COLOR: Record<ProposalStatus, ChipProps["color"]> = {
  [ProposalStatus.AwaitingConfirmation]: "accent",
  [ProposalStatus.Submitting]: "accent",
  [ProposalStatus.Submitted]: "success",
  [ProposalStatus.Rejected]: "danger",
  [ProposalStatus.Dismissed]: "default",
  [ProposalStatus.Failed]: "danger",
};

// A proposal is pencil until the user signs it: hatched while it waits, inked once submitted.
const STATUS_RULE: Record<ProposalStatus, string> = {
  [ProposalStatus.AwaitingConfirmation]: "hatch [--hatch-color:var(--accent)]",
  [ProposalStatus.Submitting]: "hatch [--hatch-color:var(--accent)]",
  [ProposalStatus.Submitted]: "bg-accent",
  [ProposalStatus.Rejected]: "bg-danger",
  [ProposalStatus.Dismissed]: "bg-separator",
  [ProposalStatus.Failed]: "bg-danger",
};

export function ProposalItem({ proposal }: { proposal: TradeProposal }) {
  const { t } = useTranslation();

  const confirm = useMutation({
    mutationFn: () => window.solyx.proposals.confirm(proposal.id),
  });

  const dismiss = useMutation({
    mutationFn: () => window.solyx.proposals.dismiss(proposal.id),
  });

  const { order } = proposal;
  const actionError = confirm.error ?? dismiss.error;

  return (
    <article className="relative flex flex-col gap-2 border-b border-separator py-3 pr-4 pl-6">
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-3 left-2.5 w-1.5",
          STATUS_RULE[proposal.status]
        )}
      />
      <header className="flex items-center gap-2">
        <h3 className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 font-semibold">
            {order.instrument.symbol}
          </span>
          <ListingName symbol={order.instrument} className="text-sm" />
          <span className="shrink-0 text-xs text-muted">
            {t(`market.${order.instrument.market}`)}
          </span>
        </h3>
        <span className="text-xs text-muted">
          {t(`source.${proposal.source}`)}
        </span>
        <Chip
          className="ml-auto"
          color={STATUS_COLOR[proposal.status]}
          size="sm">
          {t(`status.${proposal.status}`)}
        </Chip>
      </header>
      <p className="text-sm tabular-nums">
        {t("proposals.summary", {
          side: t(`side.${order.side}`),
          quantity: order.quantity,
          price:
            order.type === OrderType.Limit
              ? order.limitPrice
              : t("proposals.market-price"),
        })}
      </p>
      {proposal.rationale && (
        <p className="text-sm text-muted">{proposal.rationale}</p>
      )}
      {proposal.violations.length > 0 ? (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t("proposals.violations-title")}</Alert.Title>
            <ul className="list-disc pl-4 text-sm text-muted">
              {proposal.violations.map((violation) => (
                <li key={violation.code}>{violationMessage(t, violation)}</li>
              ))}
            </ul>
          </Alert.Content>
        </Alert>
      ) : null}
      {/* A failed submission is terminal: the broker may have taken the order, so no retry is offered. */}
      {proposal.failure ? (
        <ErrorAlert
          title={t("proposals.submit-failed")}
          description={
            proposal.failure.code === SubmissionFailureCode.Interrupted
              ? t("proposals.submit-interrupted")
              : proposal.failure.message
          }
        />
      ) : null}
      {actionError ? (
        <ErrorAlert
          title={t("common.error-title")}
          description={actionError.message}
        />
      ) : null}
      {proposal.status === ProposalStatus.AwaitingConfirmation && (
        <div className="flex gap-2 pt-1">
          {/* The app's only ink-filled button: signing is the one act that makes a trade real. */}
          <Button
            size="sm"
            isPending={confirm.isPending}
            isDisabled={dismiss.isPending}
            onPress={() => confirm.mutate()}>
            {t("proposals.confirm")}
          </Button>
          <Button
            size="sm"
            variant="tertiary"
            isPending={dismiss.isPending}
            isDisabled={confirm.isPending}
            onPress={() => dismiss.mutate()}>
            {t("proposals.dismiss")}
          </Button>
        </div>
      )}
    </article>
  );
}
