import { MemoryPublisher } from "@orpc/publisher/memory";
import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";

import { openFubonSession } from "@solyx/brokers/fubon";
import type { FubonSession } from "@solyx/brokers/fubon";

import { keepMessages } from "../main/rpc/messages.ts";
import type { Change } from "../shared/rpc/changes.ts";

import { fubonContract } from "./fubon.contract.ts";

let session: FubonSession | undefined;

const changes = new MemoryPublisher<{ changed: Change }>();

function signedIn(): FubonSession {
  if (!session) throw new Error("Not signed in to Fubon");

  return session;
}

const fubon = implement(fubonContract);

// Every SDK call blocks until Fubon answers, so the process answers one call at a time, in order.
const handler = new RPCHandler(
  fubon.router({
    open: fubon.open.handler(({ input }) => {
      session = openFubonSession(input);
      session.onChange(() => void changes.publish("changed", {}));

      return session.accounts;
    }),
    realtime: fubon.realtime.handler(() => signedIn().realtime()),
    holdings: fubon.holdings.handler(({ input }) => signedIn().holdings(input)),
    orders: fubon.orders.handler(({ input: { account, from } }) =>
      signedIn().orders(account, from)
    ),
    fills: fubon.fills.handler(({ input: { account, from } }) =>
      signedIn().fills(account, from)
    ),
    place: fubon.place.handler(({ input: { account, order } }) =>
      signedIn().place(account, order)
    ),
    cancel: fubon.cancel.handler(({ input: { account, id } }) =>
      signedIn().cancel(account, id)
    ),
    placeCondition: fubon.placeCondition.handler(
      ({ input: { account, leg } }) => signedIn().placeCondition(account, leg)
    ),
    conditions: fubon.conditions.handler(({ input }) =>
      signedIn().conditions(input)
    ),
    cancelCondition: fubon.cancelCondition.handler(
      ({ input: { account, guid } }) =>
        signedIn().cancelCondition(account, guid)
    ),
    changes: fubon.changes.handler(({ signal }) =>
      changes.subscribe("changed", { signal })
    ),
    close: fubon.close.handler(() => {
      session?.close();
      session = undefined;
    }),
  }),
  { clientInterceptors: [keepMessages] }
);

// The main process hands over one end of a channel as the process starts and calls through it.
process.parentPort.once("message", ({ ports: [port] }) => {
  handler.upgrade(port);
  port.start();
});
