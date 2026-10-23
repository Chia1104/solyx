import { askingDevice } from "../../rpc/access.ts";
import { ClientKind, contractOS } from "../../rpc/context.ts";

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
  thisDevice: contractOS.devices.thisDevice.handler(({ context }) =>
    context.client.kind === ClientKind.Device
      ? context.devices.thisDevice(context.client.device)
      : null
  ),
  passkeyOptions: contractOS.devices.passkeyOptions.handler(({ context }) =>
    context.devices.passkeys.passkeyOptions(askingDevice(context.client))
  ),
  addPasskey: contractOS.devices.addPasskey.handler(({ context, input }) =>
    context.devices.passkeys.addPasskey(askingDevice(context.client), input)
  ),
  actionOptions: contractOS.devices.actionOptions.handler(
    ({ context, input }) =>
      context.devices.passkeys.actionOptions(
        askingDevice(context.client),
        input
      )
  ),
});
