import { join } from "node:path";

import { utilityProcess } from "electron";

import type { FubonSessionOptions } from "@solyx/brokers/fubon";

import { connectFubon } from "./fubon-client.ts";
import type { FubonProcess } from "./fubon-client.ts";

// Main is bundled into dist/main, next to dist/utility.
const FUBON_ENTRY = join(import.meta.dirname, "../utility/fubon.mjs");

/**
 * Signs in to Fubon from a utility process, since the SDK's calls block until Fubon answers,
 * its native code could crash, and it moves its process to the folder it logs to.
 */
export function openFubonProcess(
  options: FubonSessionOptions
): Promise<FubonProcess> {
  return connectFubon(
    utilityProcess.fork(FUBON_ENTRY, [], { serviceName: "Fubon SDK" }),
    options
  );
}
