import { useEffect, useRef } from "react";

import { Disclosure } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { partition } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { ProposalStatus } from "@solyx/core/order-desk";

import { usePaletteColors } from "../../app/theme.ts";
import { highlight } from "../../components/highlight.ts";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";

import { ProposalItem } from "./proposal-item.tsx";
import { proposalsQuery } from "./proposals-query.ts";

const PENDING: readonly ProposalStatus[] = [
  ProposalStatus.AwaitingConfirmation,
  ProposalStatus.Submitting,
];

/** Proposals still waiting on the user, newest first, above the ones already decided. */
export function ProposalQueue() {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(proposalsQuery());
  const { accent } = usePaletteColors();
  const queue = useRef<HTMLDivElement>(null);
  const decidedCount = useRef<number | undefined>(undefined);

  const decidedNow = data?.filter(
    (proposal) => !PENDING.includes(proposal.status)
  ).length;

  // A proposal leaves the queue once decided, so the history it moved into lights up.
  useEffect(() => {
    if (decidedNow === undefined) return;

    const before = decidedCount.current;

    decidedCount.current = decidedNow;

    if (before !== undefined && decidedNow > before) {
      highlight(queue.current?.querySelector("[data-history]"), accent);
    }
  }, [decidedNow, accent]);

  if (error) {
    return (
      <div className="px-4">
        <LoadError error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (!data) return <LoadingState />;

  const [pending, decided] = partition(data.toReversed(), (proposal) =>
    PENDING.includes(proposal.status)
  );

  return (
    <div ref={queue} className="flex flex-col">
      {pending.map((proposal) => (
        <ProposalItem key={proposal.id} proposal={proposal} />
      ))}
      {decided.length > 0 ? (
        <Disclosure>
          <Disclosure.Heading>
            <Disclosure.Trigger
              data-history
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-muted">
              {t("proposals.history")}
              <span className="text-xs tabular-nums">{decided.length}</span>
              <Disclosure.Indicator className="ml-auto" />
            </Disclosure.Trigger>
          </Disclosure.Heading>
          <Disclosure.Content>
            {decided.map((proposal) => (
              <ProposalItem key={proposal.id} proposal={proposal} />
            ))}
          </Disclosure.Content>
        </Disclosure>
      ) : null}
    </div>
  );
}
