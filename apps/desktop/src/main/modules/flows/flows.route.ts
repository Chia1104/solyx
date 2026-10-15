import { contractOS } from "../../rpc/context.ts";

export const flowsRouter = contractOS.flows.router({
  listing: contractOS.flows.listing.handler(({ context, input }) =>
    context.flows.listing(input)
  ),
  market: contractOS.flows.market.handler(({ context, input }) =>
    context.flows.market(input)
  ),
});
