import { contractOS } from "../../rpc/context.ts";

import { financialTrends } from "./financial-trends.ts";

export const fundamentalsRouter = contractOS.fundamentals.router({
  trends: contractOS.fundamentals.trends.handler(({ context, input }) =>
    financialTrends(context.fundamentals, input)
  ),
});
