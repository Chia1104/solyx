import { Alert, Button, Chip, cn } from "@heroui/react";
import type { ChipProps } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Interval } from "@solyx/core/candles";
import type { MandateVerdict } from "@solyx/core/mandate";
import { exchangeDate } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { OrderType, orderImpact } from "@solyx/core/order";
import type { OrderRequest } from "@solyx/core/order";
import { ProposalStatus, SubmissionFailureCode } from "@solyx/core/order-desk";
import type { ProposalBasis, TradeProposal } from "@solyx/core/order-desk";
import type { OrderPremise } from "@solyx/core/risk";

import { orpc } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { ListingName } from "../market/listing-name.tsx";
import { LowerView } from "../market/lower-view.ts";
import { numberFormats } from "../market/number-formats.ts";
import { quoteQuery } from "../market/quote-query.ts";
import { mandateViolationMessage } from "../settings/mandate-message.ts";
import { tradingSettingsQuery } from "../settings/settings-query.ts";

import { violationMessage } from "./violation-message.ts";

const STATUS_COLOR: Record<ProposalStatus, ChipProps["color"]> = {
  [ProposalStatus.AwaitingConfirmation]: "accent",
  [ProposalStatus.Confirming]: "accent",
  [ProposalStatus.Submitting]: "accent",
  [ProposalStatus.Submitted]: "success",
  [ProposalStatus.Rejected]: "danger",
  [ProposalStatus.Dismissed]: "default",
  [ProposalStatus.Failed]: "danger",
};

// A proposal is pencil until the user signs it: hatched while it waits, inked once submitted.
const STATUS_RULE: Record<ProposalStatus, string> = {
  [ProposalStatus.AwaitingConfirmation]: "hatch [--hatch-color:var(--accent)]",
  [ProposalStatus.Confirming]: "hatch [--hatch-color:var(--accent)]",
  [ProposalStatus.Submitting]: "hatch [--hatch-color:var(--accent)]",
  [ProposalStatus.Submitted]: "bg-accent",
  [ProposalStatus.Rejected]: "bg-danger",
  [ProposalStatus.Dismissed]: "bg-separator",
  [ProposalStatus.Failed]: "bg-danger",
};

/**
 * What the order would spend and leave the account holding, filled whole at its limit price, or a
 * market order at the limit-up of the session it was proposed for, the most it could fill at.
 */
function OrderImpactLines({
  order,
  premise,
}: {
  order: OrderRequest;
  premise: OrderPremise | null;
}) {
  const { t, i18n } = useTranslation();
  const { amount, price } = numberFormats(i18n.language);
  const account = useQuery(orpc.account.summary.queryOptions());
  const limitUp = premise?.band?.high;

  const sized: OrderRequest | null =
    order.type === OrderType.Limit
      ? order
      : limitUp === undefined
        ? null
        : { ...order, type: OrderType.Limit, limitPrice: limitUp };

  const impact = account.data && sized && orderImpact(sized, account.data);

  if (!impact) return null;

  const { currency, notional, cash, shares } = impact;

  return (
    <p className="flex flex-col text-xs text-muted tabular-nums">
      <span>
        {limitUp === undefined || order.type === OrderType.Limit
          ? t("proposals.impact.notional", {
              amount: amount.format(notional),
              currency,
            })
          : t("proposals.premise.impact-most", {
              amount: amount.format(notional),
              currency,
              price: price.format(limitUp),
            })}
      </span>
      <span>
        {cash &&
          `${t("proposals.impact.cash", {
            before: amount.format(cash.before),
            after: amount.format(cash.after),
            currency,
          })} · `}
        {t("proposals.impact.shares", {
          before: shares.before,
          after: shares.after,
        })}
      </span>
    </p>
  );
}

/** Where the market stood as the proposal was made, against its last price now. */
function PremiseLine({
  symbol,
  premise: { session, price: then },
}: {
  symbol: SymbolRef;
  premise: OrderPremise;
}) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);
  const now = useQuery(quoteQuery(symbol)).data?.last;

  return (
    <p className="text-xs text-muted tabular-nums">
      {then === null
        ? t("proposals.premise.proposed-for", { date: session })
        : t("proposals.premise.proposed-at", {
            price: format.price.format(then),
            date: session,
          })}
      {then !== null && now !== undefined ? (
        <>
          {" · "}
          {t("proposals.premise.now", {
            price: format.price.format(now),
            change: format.percentChange.format(now / then - 1),
          })}
        </>
      ) : null}
    </p>
  );
}

/** The research the proposal was made under, as the desk kept it, and the way to the listing's research now. */
function BasisLine({
  symbol,
  basis: { report, forecast },
}: {
  symbol: SymbolRef;
  basis: ProposalBasis;
}) {
  const { t } = useTranslation();
  const day = (at: number) => exchangeDate(symbol.market, new Date(at));

  if (!report) {
    return <p className="text-xs text-muted">{t("proposals.basis.none")}</p>;
  }

  return (
    <p className="text-xs text-muted tabular-nums">
      {t("proposals.basis.report", {
        revision: report.revision,
        stance: t(`research.stance.${report.stance}`),
        date: day(report.revisedAt),
      })}
      {" · "}
      {forecast
        ? t("proposals.basis.forecast", {
            direction: t(`research.direction.${forecast.direction}`),
            count: forecast.horizon,
            date: day(forecast.createdAt),
          })
        : t("proposals.basis.no-forecast")}{" "}
      <Link
        to="/symbol/$market/$symbol"
        params={symbol}
        search={{ interval: Interval.OneDay, view: LowerView.Research }}
        className="text-foreground underline">
        {t("proposals.basis.open")}
      </Link>
    </p>
  );
}

/** What the user's mandate made of an agent's proposal: sent it, would have in shadow, or why not. */
function MandateLine({ verdict }: { verdict: MandateVerdict }) {
  const { t } = useTranslation();

  if (verdict.violations.length > 0) {
    return (
      <p className="text-xs text-muted">
        {t("proposals.mandate.outside", {
          reasons: verdict.violations
            .map((violation) => mandateViolationMessage(t, violation))
            .join(t("proposals.mandate.separator")),
        })}
      </p>
    );
  }

  return (
    <p className="text-xs text-muted">
      {verdict.shadow
        ? t("proposals.mandate.would-send")
        : t("proposals.mandate.sent")}
    </p>
  );
}

export function ProposalItem({ proposal }: { proposal: TradeProposal }) {
  const { t } = useTranslation();

  const confirm = useMutation(orpc.proposals.confirm.mutationOptions());
  const locked = useQuery(tradingSettingsQuery()).data?.locked ?? false;

  const dismiss = useMutation(orpc.proposals.dismiss.mutationOptions());
  const reconcile = useMutation(orpc.proposals.reconcile.mutationOptions());

  const { order, failure } = proposal;
  const actionError = confirm.error ?? dismiss.error ?? reconcile.error;

  // Only a failure the broker did not answer leaves an order it may hold to look for.
  const unanswered =
    failure?.code === SubmissionFailureCode.Unknown ||
    failure?.code === SubmissionFailureCode.Interrupted;

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
      {proposal.status === ProposalStatus.AwaitingConfirmation ? (
        <>
          {proposal.premise ? (
            <PremiseLine symbol={order.instrument} premise={proposal.premise} />
          ) : null}
          <OrderImpactLines order={order} premise={proposal.premise} />
        </>
      ) : null}
      {proposal.rationale && (
        <p className="text-sm text-muted">{proposal.rationale}</p>
      )}
      {proposal.basis ? (
        <BasisLine symbol={order.instrument} basis={proposal.basis} />
      ) : null}
      {proposal.mandate ? <MandateLine verdict={proposal.mandate} /> : null}
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
      {/* A failed submission is terminal: unless the broker refused it, it may have taken the order, so no retry is offered. */}
      {failure ? (
        <ErrorAlert
          title={t(`proposals.failure.${failure.code}`)}
          description={
            "message" in failure
              ? failure.message
              : t(`proposals.failure.${failure.code}-detail`)
          }
        />
      ) : null}
      {actionError ? (
        <ErrorAlert
          title={t("common.error-title")}
          description={actionError.message}
        />
      ) : null}
      {unanswered ? (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant="secondary"
            isPending={reconcile.isPending}
            onPress={() => reconcile.mutate(undefined)}>
            {t("proposals.reconcile")}
          </Button>
        </div>
      ) : null}
      {proposal.status === ProposalStatus.AwaitingConfirmation && (
        <div className="flex gap-2 pt-1">
          {/* The app's only ink-filled button: signing is the one act that makes a trade real. */}
          <Button
            size="sm"
            isPending={confirm.isPending}
            // Locked orders would only be refused, which would end the proposal.
            isDisabled={dismiss.isPending || locked}
            onPress={() => confirm.mutate(proposal.id)}>
            {t("proposals.confirm")}
          </Button>
          <Button
            size="sm"
            variant="tertiary"
            isPending={dismiss.isPending}
            isDisabled={confirm.isPending}
            onPress={() => dismiss.mutate(proposal.id)}>
            {t("proposals.dismiss")}
          </Button>
        </div>
      )}
    </article>
  );
}
