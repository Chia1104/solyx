import type { SymbolRef } from "@solyx/core/market";
import { ProposalStatus } from "@solyx/core/order-desk";
import type { OrderDesk } from "@solyx/core/order-desk";
import type { ResearchDesk } from "@solyx/core/research";

import type { Approval, Inbox } from "#shared/rpc/inbox.contract.ts";

export interface InboxOptions {
  desk: Pick<OrderDesk, "list">;
  approvals: () => Promise<Approval[]>;
  /** What the user holds, then what they watch. */
  followed: () => Promise<SymbolRef[]>;
  research: Pick<ResearchDesk, "backlog">;
}

/**
 * What waits for the user, as the overview lists it, read from what the app keeps so telling
 * costs no request: each item leaves once it is handled, a proposal confirmed or dismissed, a
 * call answered, a report revised.
 */
export function createInbox({
  desk,
  approvals,
  followed,
  research,
}: InboxOptions) {
  return {
    async list(): Promise<Inbox> {
      const [asked, listings] = await Promise.all([approvals(), followed()]);

      return {
        proposals: desk
          .list()
          .filter(
            ({ status }) => status === ProposalStatus.AwaitingConfirmation
          ),
        approvals: asked,
        reports: listings.flatMap((symbol) => {
          const backlog = research.backlog(symbol);

          return backlog &&
            (backlog.signals.length > 0 || backlog.passedEvents.length > 0)
            ? [backlog]
            : [];
        }),
      };
    },
  };
}
