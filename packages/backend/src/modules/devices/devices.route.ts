import { contractOS } from "../../rpc/context.ts";

export const devicesRouter = contractOS.devices.router({
  remoteAccess: contractOS.devices.remoteAccess.handler(({ context }) =>
    context.devices.remoteAccess()
  ),
  setEnabled: contractOS.devices.setEnabled.handler(({ context, input }) =>
    context.devices.setEnabled(input)
  ),
  pairingCode: contractOS.devices.pairingCode.handler(({ context }) =>
    context.devices.pairingCode()
  ),
  list: contractOS.devices.list.handler(({ context }) =>
    context.devices.list()
  ),
  remove: contractOS.devices.remove.handler(({ context, input }) =>
    context.devices.remove(input)
  ),
  changes: contractOS.devices.changes.handler(({ context, signal }) =>
    context.windowEvents.subscribe("devices:changed", { signal })
  ),
});
