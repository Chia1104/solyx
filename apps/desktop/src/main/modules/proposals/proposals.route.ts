import { ProposalSource } from "@solyx/core/order-desk";

import { contractOS } from "../../rpc/context.ts";

export const proposalsRouter = contractOS.proposals.router({
  list: contractOS.proposals.list.handler(({ context }) => context.desk.list()),
  propose: contractOS.proposals.propose.handler(({ context, input }) =>
    context.desk.propose({ ...input, source: ProposalSource.User })
  ),
  // The single road to broker.placeOrder. Never hand confirm to an agent as a tool.
  confirm: contractOS.proposals.confirm.handler(({ context, input }) =>
    context.desk.confirm(input.id)
  ),
  dismiss: contractOS.proposals.dismiss.handler(({ context, input }) =>
    context.desk.dismiss(input.id)
  ),
  changes: contractOS.proposals.changes.handler(({ context, signal }) =>
    context.windowEvents.subscribe("proposals:changed", { signal })
  ),
});
