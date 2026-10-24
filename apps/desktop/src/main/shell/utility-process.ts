import { join } from "node:path";

import { MessageChannelMain, utilityProcess } from "electron";

import { UtilityKind } from "../../utility/host.contract.ts";

/**
 * Each kind's entry, bundled into dist/utility beside main's dist/main. Fubon's SDK runs apart from
 * the backend since its calls block until Fubon answers, its native code could crash, and it moves
 * its process to the folder it logs to. The kernel runs apart since its native code could crash and
 * is loaded from beside the asar whose hash the binary checks, so its process is handed no port but
 * the backend's and holds nothing of it.
 */
const UTILITIES = {
  [UtilityKind.Fubon]: { entry: "fubon.mjs", serviceName: "Fubon SDK" },
  [UtilityKind.Kernel]: { entry: "kernel.mjs", serviceName: "Kernel" },
} satisfies Record<UtilityKind, { entry: string; serviceName: string }>;

/**
 * Starts a utility process of `kind`, which serves the backend on the other end of the returned
 * port, taken as it starts.
 */
export function forkUtility(kind: UtilityKind) {
  const { entry, serviceName } = UTILITIES[kind];

  const child = utilityProcess.fork(
    join(import.meta.dirname, "../utility", entry),
    [],
    { serviceName }
  );

  const { port1, port2 } = new MessageChannelMain();

  child.postMessage(null, [port2]);

  return { child, port: port1 };
}
