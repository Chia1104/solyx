import { contractOS } from "../../rpc/context.ts";

export const updatesRouter = contractOS.updates.router({
  state: contractOS.updates.state.handler(({ context }) =>
    context.updates.state()
  ),
  check: contractOS.updates.check.handler(({ context }) =>
    context.updates.check()
  ),
  install: contractOS.updates.install.handler(({ context }) =>
    context.updates.install()
  ),
  changes: contractOS.updates.changes.handler(({ context, signal }) =>
    context.windowEvents.subscribe("updates:changed", { signal })
  ),
});
