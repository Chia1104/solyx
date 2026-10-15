import { contractOS } from "../../rpc/context.ts";

// Reading only: reports and forecasts are the agent's to write, through its tools.
export const researchRouter = contractOS.research.router({
  coverage: contractOS.research.coverage.handler(({ context, input }) =>
    context.research.desk.coverage(input)
  ),
  changes: contractOS.research.changes.handler(({ context, signal }) =>
    context.windowEvents.subscribe("research:changed", { signal })
  ),
});
