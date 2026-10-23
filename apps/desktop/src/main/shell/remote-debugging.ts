import type { CommandLine } from "electron";

import { AppChannel } from "../host.ts";

/** Chromium's switches that open the DevTools protocol, on a port or on pipes, to whoever started the app. */
const DEVTOOLS_PROTOCOL_SWITCHES = [
  "remote-debugging-port",
  "remote-debugging-pipe",
];

/**
 * Whether the run must quit before it opens anything. The protocol drives a window, which can
 * confirm orders and set a mandate, so only a development run and the test package, each with
 * data and secrets of its own, accept it.
 */
export function refusesRemoteDebugging(
  channel: AppChannel,
  commandLine: Pick<CommandLine, "hasSwitch">
): boolean {
  if (channel === AppChannel.Development || channel === AppChannel.Test)
    return false;

  return DEVTOOLS_PROTOCOL_SWITCHES.some((name) => commandLine.hasSwitch(name));
}
