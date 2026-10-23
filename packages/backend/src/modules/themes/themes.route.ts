import { contractOS } from "../../rpc/context.ts";

export const themesRouter = contractOS.themes.router({
  list: contractOS.themes.list.handler(({ context }) =>
    context.themes.desk.list()
  ),
  create: contractOS.themes.create.handler(({ context, input }) => {
    context.themes.desk.save(input);
  }),
  update: contractOS.themes.update.handler(({ context, input }) =>
    context.themes.update(input.id, input.draft)
  ),
  remove: contractOS.themes.remove.handler(({ context, input }) =>
    context.themes.desk.remove(input)
  ),
  check: contractOS.themes.check.handler(({ context, input }) =>
    context.themes.check(input)
  ),
  changes: contractOS.themes.changes.handler(({ context, signal }) =>
    context.windowEvents.subscribe("themes:changed", { signal })
  ),
});
