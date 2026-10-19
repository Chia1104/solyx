import { useEffect, useRef } from "react";

import { Disclosure } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { ProposalStatus, exitWatched } from "@solyx/core/order-desk";
import type { TradeProposal } from "@solyx/core/order-desk";

import { usePaletteColors } from "../../app/theme.ts";
import { highlight } from "../../components/highlight.ts";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { PaneSection } from "../../components/pane-section.tsx";

import { ProposalItem } from "./proposal-item.tsx";
import { proposalsQuery } from "./proposals-query.ts";

const PENDING: readonly ProposalStatus[] = [
  ProposalStatus.AwaitingConfirmation,
  ProposalStatus.Confirming,
  ProposalStatus.Submitting,
];

/** Waiting on the user, or an exit the broker still watches, which the user may cancel. */
const isOpen = (proposal: TradeProposal) =>
  PENDING.includes(proposal.status) || exitWatched(proposal);

const selectOpen = (proposals: TradeProposal[]) =>
  proposals.filter(isOpen).toReversed();

const selectDecided = (proposals: TradeProposal[]) =>
  proposals.filter((proposal) => !isOpen(proposal)).toReversed();

/** Proposals still waiting on the user and exits the broker watches, newest first. */
export function PendingProposals() {
  const { t } = useTranslation();

  const { data, error, refetch } = useQuery({
    ...proposalsQuery(),
    select: selectOpen,
  });

  return (
    <PaneSection title={t("proposals.pending")} count={data?.length}>
      {error ? (
        <div className="px-4 pb-3">
          <LoadError error={error} onRetry={() => void refetch()} />
        </div>
      ) : !data ? (
        <LoadingState />
      ) : data.length === 0 ? (
        <p className="px-4 pb-3 text-xs text-muted">
          {t("proposals.none-pending")}
        </p>
      ) : (
        // The section's own hairline closes the last one.
        <div className="[&>article:last-child]:border-b-0">
          {data.map((proposal) => (
            <ProposalItem key={proposal.id} proposal={proposal} />
          ))}
        </div>
      )}
    </PaneSection>
  );
}

/** Proposals already decided, newest first, folded away until asked for. */
export function ProposalHistory() {
  const { t } = useTranslation();
  const { data } = useQuery({ ...proposalsQuery(), select: selectDecided });
  const { accent } = usePaletteColors();
  const history = useRef<HTMLDivElement>(null);
  const decidedCount = useRef<number | undefined>(undefined);

  const decidedNow = data?.length;

  // A proposal leaves the waiting ones once decided, so the history it moved into lights up.
  useEffect(() => {
    if (decidedNow === undefined) return;

    const before = decidedCount.current;

    decidedCount.current = decidedNow;

    if (before !== undefined && decidedNow > before) {
      highlight(history.current?.querySelector("[data-history]"), accent);
    }
  }, [decidedNow, accent]);

  if (!data?.length) return null;

  return (
    <div ref={history} className="border-b border-separator">
      <Disclosure>
        <Disclosure.Heading>
          <Disclosure.Trigger
            data-history
            className="flex w-full items-center gap-2 px-4 py-2.5 text-xs font-medium text-muted">
            {t("proposals.history")}
            <span className="tabular-nums">{data.length}</span>
            <Disclosure.Indicator className="ml-auto" />
          </Disclosure.Trigger>
        </Disclosure.Heading>
        <Disclosure.Content>
          <div className="border-t border-separator [&>article:last-child]:border-b-0">
            {data.map((proposal) => (
              <ProposalItem key={proposal.id} proposal={proposal} />
            ))}
          </div>
        </Disclosure.Content>
      </Disclosure>
    </div>
  );
}
