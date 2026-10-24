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
});
