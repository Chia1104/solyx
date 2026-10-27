import { StrategyApprover } from "@solyx/core/strategy";

import { contractOS } from "../../rpc/context.ts";

export const strategiesRouter = contractOS.strategies.router({
  list: contractOS.strategies.list.handler(({ context }) =>
    context.strategies.catalog()
  ),
  approve: contractOS.strategies.approve.handler(({ context, input }) =>
    context.strategies.approve(input.name, input.version, StrategyApprover.User)
  ),
  review: contractOS.strategies.review.handler(({ context, input }) =>
    context.strategies.review(input)
  ),
  draft: contractOS.strategies.draft.handler(
    ({ context, input: { name, version, files, remove } }) =>
      context.strategies.reviewDraft(name, version, { files, remove })
  ),
  revoke: contractOS.strategies.revoke.handler(({ context, input }) =>
    context.strategies.revoke(input)
  ),
  trash: contractOS.strategies.trash.handler(({ context, input }) =>
    context.strategies.trash(input)
  ),
  reveal: contractOS.strategies.reveal.handler(({ context, input }) =>
    context.strategies.reveal(input)
  ),
  runtimes: contractOS.strategies.runtimes.handler(({ context, signal }) =>
    context.strategies.runtimes(signal)
  ),
  changes: contractOS.strategies.changes.handler(({ context, signal }) =>
    context.windowEvents.subscribe("strategies:changed", { signal })
  ),
});
