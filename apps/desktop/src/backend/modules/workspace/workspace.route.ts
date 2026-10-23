import { contractOS } from "../../rpc/context.ts";

export const workspaceRouter = contractOS.workspace.router({
  takeDestination: contractOS.workspace.takeDestination.handler(({ context }) =>
    context.workspace.takeDestination()
  ),
  changes: contractOS.workspace.changes.handler(({ context, signal }) =>
    context.windowEvents.subscribe("workspace:changed", { signal })
  ),
});
