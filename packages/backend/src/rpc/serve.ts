import type { SupportedMessagePort } from "@orpc/client/message-port";
import { RPCHandler } from "@orpc/server/message-port";

import type { RpcContext } from "./context.ts";
import { keepMessages } from "./messages.ts";
import { router } from "./router.ts";

/** Serves the router on clients' ports; built once, since each port keeps its own calls. */
export const rpcHandler = new RPCHandler(router, {
  clientInterceptors: [keepMessages],
});

/**
 * Serves every procedure on `port` as the client it belongs to. A port closes with its page,
 * which ends the streams it was sent, so a reload or a closed window leaves no listener.
 */
export function serveClient(
  port: SupportedMessagePort & { start(): void },
  context: RpcContext
) {
  rpcHandler.upgrade(port, { context });
  port.start();
}
