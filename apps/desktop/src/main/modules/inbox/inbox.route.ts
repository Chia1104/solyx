import { contractOS } from "../../rpc/context.ts";

export const inboxRouter = contractOS.inbox.router({
  list: contractOS.inbox.list.handler(({ context }) => context.inbox.list()),
  changes: contractOS.inbox.changes.handler(({ context, signal }) =>
    context.windowEvents.subscribe("inbox:changed", { signal })
  ),
});
