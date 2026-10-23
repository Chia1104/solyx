import { expect, test } from "vite-plus/test";

import { isForDevices } from "@solyx/api/rpc/access";
import { routerContract } from "@solyx/api/rpc/router.contract";

test("what sends or cancels orders, unseals, widens reach or pairs is never for devices", () => {
  const never = {
    "proposals.confirm": routerContract.proposals.confirm,
    "proposals.cancelExit": routerContract.proposals.cancelExit,
    "account.cancel": routerContract.account.cancel,
    "agent.approve": routerContract.agent.approve,
    "agent.setApprovalMode": routerContract.agent.setApprovalMode,
    "agent.restart": routerContract.agent.restart,
    "settings.setMandate": routerContract.settings.setMandate,
    "settings.revokeMandate": routerContract.settings.revokeMandate,
    "settings.setOrdersLocked": routerContract.settings.setOrdersLocked,
    "settings.setTradingAccount": routerContract.settings.setTradingAccount,
    "settings.saveSecret": routerContract.settings.saveSecret,
    "settings.saveAgentKey": routerContract.settings.saveAgentKey,
    "settings.setAgentEndpoint": routerContract.settings.setAgentEndpoint,
    "settings.setAgentShell": routerContract.settings.setAgentShell,
    "settings.signInSubscription": routerContract.settings.signInSubscription,
    "settings.signInCodes": routerContract.settings.signInCodes,
    "settings.chooseFubonFile": routerContract.settings.chooseFubonFile,
    "settings.about": routerContract.settings.about,
    "settings.mcp": routerContract.settings.mcp,
    "settings.restart": routerContract.settings.restart,
    "backup.restore": routerContract.backup.restore,
    "storage.clear": routerContract.storage.clear,
    "schedules.create": routerContract.schedules.create,
    "updates.install": routerContract.updates.install,
    "workspace.takeDestination": routerContract.workspace.takeDestination,
    "devices.remoteAccess": routerContract.devices.remoteAccess,
    "devices.setEnabled": routerContract.devices.setEnabled,
    "devices.pairingCode": routerContract.devices.pairingCode,
    "devices.list": routerContract.devices.list,
    "devices.remove": routerContract.devices.remove,
  };

  for (const [path, procedure] of Object.entries(never)) {
    expect(isForDevices(procedure), path).not.toBe(true);
  }
});

test("what sends or cancels at the broker reaches devices only with a passkey's signature", () => {
  const signed = {
    "proposals.confirmSigned": routerContract.proposals.confirmSigned,
    "proposals.cancelExitSigned": routerContract.proposals.cancelExitSigned,
    "account.cancelSigned": routerContract.account.cancelSigned,
  };

  for (const [path, procedure] of Object.entries(signed)) {
    expect(isForDevices(procedure), path).toBe(true);
    expect(
      procedure["~orpc"].inputSchemas?.[0]?.["~standard"].validate({
        id: "p1",
      }),
      path
    ).toHaveProperty("issues");
  }
});
