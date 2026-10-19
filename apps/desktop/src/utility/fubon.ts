import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";

import { openFubonSession } from "@solyx/brokers/fubon";
import type { FubonSession } from "@solyx/brokers/fubon";

import { keepMessages } from "../main/rpc/messages.ts";

import { fubonContract } from "./fubon.contract.ts";

let session: FubonSession | undefined;

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

      return session.accounts;
    }),
    realtime: fubon.realtime.handler(() => signedIn().realtime()),
    holdings: fubon.holdings.handler(() => signedIn().holdings()),
    orders: fubon.orders.handler(({ input }) => signedIn().orders(input)),
    fills: fubon.fills.handler(({ input }) => signedIn().fills(input)),
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
