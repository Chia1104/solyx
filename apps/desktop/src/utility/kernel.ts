import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";

import { kernelContract } from "@solyx/backend/modules/kernel/kernel.contract";
import { keepMessages } from "@solyx/backend/rpc/messages";
import { kernel } from "@solyx/kernel/kernel";

const served = implement(kernelContract);

// Columns cross as the structured clone copies them, typed arrays whole, rather than as JSON. Each
// call runs to its end before the next is read, so calls answer in turn.
const handler = new RPCHandler(
  served.router({
    backtest: served.backtest.handler(({ input }) => kernel.backtest(input)),
    scan: served.scan.handler(({ input }) => kernel.scan(input)),
    walkForward: served.walkForward.handler(({ input }) =>
      kernel.walkForward(input)
    ),
  }),
  { clientInterceptors: [keepMessages], experimental_transfer: () => [] }
);

// The main process hands over one end of a channel as the process starts, and the backend calls through it.
process.parentPort.once("message", ({ ports: [port] }) => {
  handler.upgrade(port);
  port.start();
});
