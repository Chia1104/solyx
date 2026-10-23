import { join } from "node:path";

import { MessageChannelMain, utilityProcess } from "electron";

// Main is bundled into dist/main, next to dist/utility.
const FUBON_ENTRY = join(import.meta.dirname, "../utility/fubon.mjs");

/**
 * Starts a utility process for one Fubon sign-in, since the SDK's calls block until Fubon answers,
 * its native code could crash, and it moves its process to the folder it logs to. The process
 * serves its session on the other end of the returned port, which it takes as it starts.
 */
export function forkFubon() {
  const child = utilityProcess.fork(FUBON_ENTRY, [], {
    serviceName: "Fubon SDK",
  });

  const { port1, port2 } = new MessageChannelMain();

  child.postMessage(null, [port2]);

  return { child, port: port1 };
}
