import { join } from "node:path";

import { MessageChannelMain, utilityProcess } from "electron";

import type { FubonSessionOptions } from "@solyx/brokers/fubon";

import { connectFubon } from "../modules/market/fubon-client.ts";
import type { FubonProcess } from "../modules/market/fubon-client.ts";

// Main is bundled into dist/main, next to dist/utility.
const FUBON_ENTRY = join(import.meta.dirname, "../utility/fubon.mjs");

/**
 * Signs in to Fubon from a utility process, since the SDK's calls block until Fubon answers,
 * its native code could crash, and it moves its process to the folder it logs to.
 */
export function openFubonProcess(
  options: FubonSessionOptions
): Promise<FubonProcess> {
  const child = utilityProcess.fork(FUBON_ENTRY, [], {
    serviceName: "Fubon SDK",
  });

  const { port1, port2 } = new MessageChannelMain();

  // The process serves its session on the other end, which it takes as it starts.
  child.postMessage(null, [port2]);
  port1.start();

  return connectFubon(child, port1, options);
}
