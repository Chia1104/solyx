import { contractOS } from "../../rpc/context.ts";

export const backupRouter = contractOS.backup.router({
  settings: contractOS.backup.settings.handler(({ context }) =>
    context.backups.settings()
  ),
  set: contractOS.backup.set.handler(({ context, input }) =>
    context.backups.set(input.setting, input.value)
  ),
  setAutomatic: contractOS.backup.setAutomatic.handler(({ context, input }) =>
    context.backups.setAutomatic(input)
  ),
  setEvery: contractOS.backup.setEvery.handler(({ context, input }) =>
    context.backups.setEvery(input)
  ),
  status: contractOS.backup.status.handler(({ context }) =>
    context.backups.status()
  ),
  backUp: contractOS.backup.backUp.handler(({ context }) =>
    context.backups.backUp()
  ),
  list: contractOS.backup.list.handler(({ context }) => context.backups.list()),
  restore: contractOS.backup.restore.handler(({ context, input }) =>
    context.backups.restore(input)
  ),
  changes: contractOS.backup.changes.handler(({ context, signal }) =>
    context.windowEvents.subscribe("backup:changed", { signal })
  ),
});
