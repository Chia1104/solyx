import { SignedActionKind } from "@solyx/api/devices";
import { ProposalSource } from "@solyx/core/order-desk";

import { askingDevice } from "../../rpc/access.ts";
import { contractOS } from "../../rpc/context.ts";

export const proposalsRouter = contractOS.proposals.router({
  list: contractOS.proposals.list.handler(({ context }) => context.desk.list()),
  propose: contractOS.proposals.propose.handler(({ context, input }) =>
    context.desk.propose({ ...input, source: ProposalSource.User })
  ),
  // The single road to broker.placeOrder. Never hand confirm to an agent as a tool.
  confirm: contractOS.proposals.confirm.handler(({ context, input }) =>
    context.desk.confirm(input)
  ),
  dismiss: contractOS.proposals.dismiss.handler(({ context, input }) =>
    context.desk.dismiss(input)
  ),
  // As with cancelling an order, only the user stops the broker watching an exit.
  cancelExit: contractOS.proposals.cancelExit.handler(({ context, input }) =>
    context.desk.cancelExit(input)
  ),
  // A paired browser's passkey signs the one proposal it confirms, which the desk then confirms.
  confirmSigned: contractOS.proposals.confirmSigned.handler(
    async ({ context, input }) => {
      await context.devices.passkeys.verifyAction(
        askingDevice(context.client),
        { kind: SignedActionKind.Confirm, id: input.id },
        input.assertion
      );

      return context.desk.confirm(input.id);
    }
  ),
  cancelExitSigned: contractOS.proposals.cancelExitSigned.handler(
    async ({ context, input }) => {
      await context.devices.passkeys.verifyAction(
        askingDevice(context.client),
        { kind: SignedActionKind.CancelExit, id: input.id },
        input.assertion
      );

      return context.desk.cancelExit(input.id);
    }
  ),
  reconcile: contractOS.proposals.reconcile.handler(({ context }) =>
    context.desk.reconcile()
  ),
  changes: contractOS.proposals.changes.handler(({ context, signal }) =>
    context.windowEvents.subscribe("proposals:changed", { signal })
  ),
});
