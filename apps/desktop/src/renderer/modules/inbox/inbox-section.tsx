import type { ReactNode } from "react";

import { Button } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { uniq } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { Interval } from "@solyx/core/candles";
import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { OrderType } from "@solyx/core/order";
import type { TradeProposal } from "@solyx/core/order-desk";
import type { ReportBacklog } from "@solyx/core/research";

import { DestinationKind } from "#shared/workspace.ts";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";
import { ListingName } from "../market/listing-name.tsx";
import { LowerView } from "../market/lower-view.ts";
import { showDestination } from "../workspace/destination.ts";

import { inboxQuery } from "./inbox-query.ts";

/** One thing that waits: what it is, and the button that goes where it is handled. */
function InboxRow({
  title,
  children,
  action,
  onAction,
}: {
  title: ReactNode;
  children: ReactNode;
  action: string;
  onAction: () => void;
}) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-1.5 text-sm">
          {title}
        </span>
        <div className="flex flex-col text-xs text-muted">{children}</div>
      </div>
      <Button size="sm" variant="tertiary" onPress={onAction}>
        {action}
      </Button>
    </li>
  );
}

function Listing({ symbol }: { symbol: SymbolRef }) {
  return (
    <>
      <span className="shrink-0 font-medium">{symbol.symbol}</span>
      <ListingName symbol={symbol} className="text-muted" />
    </>
  );
}

function ProposalRow({ proposal: { order } }: { proposal: TradeProposal }) {
  const { t } = useTranslation();

  return (
    <InboxRow
      title={<Listing symbol={order.instrument} />}
      action={t("inbox.open-proposals")}
      onAction={() => showDestination({ kind: DestinationKind.Proposals })}>
      <span className="tabular-nums">
        {t("inbox.proposal", {
          summary: t("proposals.summary", {
            side: t(`side.${order.side}`),
            quantity: order.quantity,
            price:
              order.type === OrderType.Limit
                ? order.limitPrice
                : t("proposals.market-price"),
          }),
        })}
      </span>
    </InboxRow>
  );
}

/** A report the news or the calendar has overtaken, with each falsifier read as stated once. */
function ReportRow({
  backlog: { report, signals, passedEvents },
}: {
  backlog: ReportBacklog;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const falsifiers = uniq(signals.map(({ falsifier }) => falsifier));

  return (
    <InboxRow
      title={<Listing symbol={report.symbol} />}
      action={t("inbox.open-research")}
      onAction={() =>
        void navigate({
          to: "/symbol/$market/$symbol",
          params: report.symbol,
          search: { interval: Interval.OneDay, view: LowerView.Research },
        })
      }>
      {falsifiers.map((falsifier) => (
        <span key={falsifier}>{t("inbox.falsifier", { falsifier })}</span>
      ))}
      {passedEvents.map(({ date, label }) => (
        <span key={`${date}:${label}`} className="tabular-nums">
          {t("inbox.event", { date, label })}
        </span>
      ))}
    </InboxRow>
  );
}

/**
 * What waits for the user, the proposals and calls that hold something up first, each with the
 * way to where it is handled; a row leaves once it is handled.
 */
export function InboxSection() {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(inboxQuery());

  let body: ReactNode = <LoadingState />;

  if (error) {
    body = <LoadError error={error} onRetry={() => void refetch()} />;
  } else if (
    data &&
    data.proposals.length + data.approvals.length + data.reports.length === 0
  ) {
    body = (
      <p className="rounded-sm pencil px-3 py-3 text-xs text-muted">
        {t("inbox.empty")}
      </p>
    );
  } else if (data) {
    body = (
      <ul className="divide-y divide-separator">
        {data.proposals.map((proposal) => (
          <ProposalRow key={proposal.id} proposal={proposal} />
        ))}
        {data.approvals.map(({ sessionId, title }) => (
          <InboxRow
            key={sessionId}
            title={title || t("agent.untitled")}
            action={t("inbox.open-conversation")}
            onAction={() =>
              showDestination({
                kind: DestinationKind.Conversation,
                sessionId,
              })
            }>
            {t("inbox.approval")}
          </InboxRow>
        ))}
        {data.reports.map((backlog) => (
          <ReportRow key={symbolKey(backlog.report.symbol)} backlog={backlog} />
        ))}
      </ul>
    );
  }

  return (
    <Section title={t("inbox.title")} description={t("inbox.description")}>
      {body}
    </Section>
  );
}
