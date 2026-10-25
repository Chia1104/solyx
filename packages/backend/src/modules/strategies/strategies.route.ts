import { StrategyApprover } from "@solyx/core/strategy";

import { contractOS } from "../../rpc/context.ts";

export const strategiesRouter = contractOS.strategies.router({
  list: contractOS.strategies.list.handler(({ context }) =>
    context.strategies.catalog()
  ),
  approve: contractOS.strategies.approve.handler(({ context, input }) =>
    context.strategies.approve(input.name, input.version, StrategyApprover.User)
  ),
  revoke: contractOS.strategies.revoke.handler(({ context, input }) =>
    context.strategies.revoke(input)
  ),
  changes: contractOS.strategies.changes.handler(({ context, signal }) =>
    context.windowEvents.subscribe("strategies:changed", { signal })
  ),
});
