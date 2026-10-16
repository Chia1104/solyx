import { contractOS } from "../../rpc/context.ts";

export const macroRouter = contractOS.macro.router({
  series: contractOS.macro.series.handler(({ context, input }) =>
    context.macro.series(input)
  ),
});
