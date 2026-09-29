import { Alert, Button, Card, Chip } from "@heroui/react";
import type { ChipProps } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { OrderType } from "@solyx/core/order";
import { ProposalStatus } from "@solyx/core/order-desk";
import type { TradeProposal } from "@solyx/core/order-desk";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { accountQueryKeys } from "../account/account-query.ts";

import { proposalsQueryKeys } from "./proposals-query.ts";
import { violationMessage } from "./violation-message.ts";

const STATUS_COLOR: Record<ProposalStatus, ChipProps["color"]> = {
  [ProposalStatus.AwaitingConfirmation]: "accent",
  [ProposalStatus.Submitting]: "accent",
  [ProposalStatus.Submitted]: "success",
  [ProposalStatus.Rejected]: "danger",
  [ProposalStatus.Dismissed]: "default",
  [ProposalStatus.Failed]: "danger",
};

export function ProposalCard({ proposal }: { proposal: TradeProposal }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // A confirmed order moves cash and positions, so the account refreshes too.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: proposalsQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: accountQueryKeys.all }),
    ]);

  const confirm = useMutation({
    mutationFn: () => window.solyx.proposals.confirm(proposal.id),
    onSettled: refresh,
  });

  const dismiss = useMutation({
    mutationFn: () => window.solyx.proposals.dismiss(proposal.id),
    onSettled: refresh,
  });

  const { order } = proposal;
  const actionError = confirm.error ?? dismiss.error;

  return (
    <Card>
      <Card.Header className="flex flex-row items-center gap-3">
        <Card.Title>
          {t(`market.${order.instrument.market}`)} {order.instrument.symbol}
        </Card.Title>
        <span>
          {t("proposals.summary", {
            side: t(`side.${order.side}`),
            quantity: order.quantity,
            price:
              order.type === OrderType.Limit
                ? order.limitPrice
                : t("proposals.market-price"),
          })}
        </span>
        <span className="text-sm text-muted">
          {t(`source.${proposal.source}`)}
        </span>
        <Chip
          className="ml-auto"
          color={STATUS_COLOR[proposal.status]}
          size="sm">
          {t(`status.${proposal.status}`)}
        </Chip>
      </Card.Header>
      <Card.Content className="flex flex-col gap-2">
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
        {proposal.error ? (
          <ErrorAlert
            title={t("proposals.submit-failed")}
            description={proposal.error}
          />
        ) : null}
        {actionError ? (
          <ErrorAlert
            title={t("common.error-title")}
            description={actionError.message}
          />
        ) : null}
      </Card.Content>
      {proposal.status === ProposalStatus.AwaitingConfirmation && (
        <Card.Footer className="flex gap-2">
          <Button
            isPending={confirm.isPending}
            isDisabled={dismiss.isPending}
            onPress={() => confirm.mutate()}>
            {t("proposals.confirm")}
          </Button>
          <Button
            variant="tertiary"
            isPending={dismiss.isPending}
            isDisabled={confirm.isPending}
            onPress={() => dismiss.mutate()}>
            {t("proposals.dismiss")}
          </Button>
        </Card.Footer>
      )}
    </Card>
  );
}
