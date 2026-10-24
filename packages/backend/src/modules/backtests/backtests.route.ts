import { contractOS } from "../../rpc/context.ts";

export const backtestsRouter = contractOS.backtests.router({
  run: contractOS.backtests.run.handler(({ context, input }) =>
    context.backtests.run(input)
  ),
  scan: contractOS.backtests.scan.handler(({ context, input }) =>
    context.backtests.scan(input)
  ),
  walkForward: contractOS.backtests.walkForward.handler(({ context, input }) =>
    context.backtests.walkForward(input)
  ),
  rolling: contractOS.backtests.rolling.handler(({ context, input }) =>
    context.backtests.rolling(input)
  ),
  history: contractOS.backtests.history.handler(({ context }) =>
    context.backtests.history()
  ),
  remove: contractOS.backtests.remove.handler(({ context, input }) =>
    context.backtests.remove(input)
  ),
  clear: contractOS.backtests.clear.handler(({ context }) =>
    context.backtests.clear()
  ),
  compare: contractOS.backtests.compare.handler(({ context, input }) =>
    context.backtests.compare(input)
  ),
  changes: contractOS.backtests.changes.handler(({ context, signal }) =>
    context.windowEvents.subscribe("backtests:changed", { signal })
  ),
});
