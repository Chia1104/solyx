import { contractOS } from "../../rpc/context.ts";

export const macroRouter = contractOS.macro.router({
  series: contractOS.macro.series.handler(({ context, input }) =>
    context.macro.series(input)
  ),
  exchangeRate: contractOS.macro.exchangeRate.handler(({ context }) =>
    context.macro.exchangeRate()
  ),
  yields: contractOS.macro.yields.handler(({ context }) =>
    context.macro.yields()
  ),
});
