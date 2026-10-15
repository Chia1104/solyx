import { contractOS } from "../../rpc/context.ts";

export const watchlistRouter = contractOS.watchlist.router({
  list: contractOS.watchlist.list.handler(({ context }) =>
    context.watchlist.list()
  ),
  add: contractOS.watchlist.add.handler(({ context, input }) =>
    context.watchlist.add(input)
  ),
  remove: contractOS.watchlist.remove.handler(({ context, input }) =>
    context.watchlist.remove(input)
  ),
  move: contractOS.watchlist.move.handler(({ context, input }) =>
    context.watchlist.move(input.symbol, input.index)
  ),
  changes: contractOS.watchlist.changes.handler(({ context, signal }) =>
    context.windowEvents.subscribe("watchlist:changed", { signal })
  ),
});
