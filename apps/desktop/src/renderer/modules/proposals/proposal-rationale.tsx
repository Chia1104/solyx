import type { ReactNode } from "react";

import { Modal } from "@heroui/react";
import { Button } from "react-aria-components";
import { useTranslation } from "react-i18next";

import type { TradeProposal } from "@solyx/core/order-desk";

import { useClock } from "../../app/clock.ts";
import { ListingName } from "../market/listing-name.tsx";

/**
 * Why the proposal was made, kept to two lines where proposals are listed; pressing it opens the
 * whole of it beside what was proposed, by whom and when.
 */
export function ProposalRationale({
  proposal,
  summary,
}: {
  proposal: TradeProposal;
  summary: ReactNode;
}) {
  const { t } = useTranslation();
  const clock = useClock();
  const { instrument } = proposal.order;

  return (
    <Modal>
      <Button className="cursor-pointer rounded-sm text-left text-sm text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent">
        <span className="line-clamp-2">{proposal.rationale}</span>
      </Button>
      <Modal.Backdrop>
        <Modal.Container scroll="inside">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header className="flex flex-col items-start gap-1">
              <Modal.Heading className="flex min-w-0 items-baseline gap-1.5">
                <span className="shrink-0">{instrument.symbol}</span>
                <ListingName symbol={instrument} />
              </Modal.Heading>
              {summary}
              <p className="text-xs text-muted tabular-nums">
                {t(`source.${proposal.source}`)}
                {" · "}
                {clock.fullTime(proposal.createdAt)}
              </p>
            </Modal.Header>
            <Modal.Body>
              <p className="text-sm whitespace-pre-wrap">
                {proposal.rationale}
              </p>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
