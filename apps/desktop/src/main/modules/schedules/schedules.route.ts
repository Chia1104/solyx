import { contractOS } from "../../rpc/context.ts";

export const schedulesRouter = contractOS.schedules.router({
  collections: contractOS.schedules.collections.handler(({ context }) =>
    context.collections.list()
  ),
  setCollection: contractOS.schedules.setCollection.handler(
    ({ context, input }) => context.collections.set(input.job, input.plan)
  ),
  collectNow: contractOS.schedules.collectNow.handler(({ context, input }) =>
    context.collections.collectNow(input)
  ),
  list: contractOS.schedules.list.handler(({ context }) =>
    context.schedules.list()
  ),
  create: contractOS.schedules.create.handler(({ context, input }) =>
    context.schedules.create(input)
  ),
  update: contractOS.schedules.update.handler(({ context, input }) =>
    context.schedules.update(input.id, input.draft)
  ),
  remove: contractOS.schedules.remove.handler(({ context, input }) =>
    context.schedules.remove(input)
  ),
  runNow: contractOS.schedules.runNow.handler(({ context, input }) =>
    context.schedules.runNow(input)
  ),
  changes: contractOS.schedules.changes.handler(({ context, signal }) =>
    context.windowEvents.subscribe("schedules:changed", { signal })
  ),
});
