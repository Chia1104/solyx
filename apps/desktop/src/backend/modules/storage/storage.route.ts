import { contractOS } from "../../rpc/context.ts";

export const storageRouter = contractOS.storage.router({
  usage: contractOS.storage.usage.handler(({ context }) =>
    context.storage.usage()
  ),
  clear: contractOS.storage.clear.handler(({ context, input }) =>
    context.storage.clear(input)
  ),
});
