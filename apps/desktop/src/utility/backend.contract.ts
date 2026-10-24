import { oc, type } from "@orpc/contract";
import * as z from "zod";

import type { AppChannel } from "@solyx/api/app-channel";
import type { AppInfo } from "@solyx/api/settings";

/** What the main process tells the backend as it starts, which is fixed for the app's run. */
export interface BackendStart {
  /** The settings file a person edits, which the backend alone writes. */
  configFile: string;
  name: string;
  version: string;
  channel: AppChannel;
  locale: string;
  dataDir: string;
  homeDir: string;
  /** Whether the channel's update feed installs what it downloads; `null` where the build has none. */
  updater: { installs: boolean } | null;
  about: Omit<AppInfo, "locations">;
  canReportCrashes: boolean;
  hasDock: boolean;
}

/** What the main process posts the backend on its parent port, each with the ports it hands over. */
export const BackendMessageKind = {
  /** With the host's port and the backend's own. */
  Start: "start",
  /** With a window's port, which the backend serves the router on. */
  Window: "window",
  /** With the port of a process the backend asked for. */
  Process: "process",
} as const;

export type BackendMessageKind =
  (typeof BackendMessageKind)[keyof typeof BackendMessageKind];

export type BackendMessage =
  | { kind: typeof BackendMessageKind.Start; start: BackendStart }
  | { kind: typeof BackendMessageKind.Window; window: number }
  | { kind: typeof BackendMessageKind.Process; id: string };

/** What the main process tells the backend of what only it sees. */
export const backendContract = {
  /** How many windows are open, after one opens or closes. */
  windows: oc.input(z.number().int().min(0)).output(type<void>()),
  /** A row of the tray's menu was picked, by its place in the menu `menu` numbered. */
  trayRow: oc
    .input(z.object({ menu: z.number().int(), row: z.number().int() }))
    .output(type<void>()),
  /** The computer woke, so timers that slept with it are due. */
  wake: oc.output(type<void>()),
  /** Whether the app stays open once its last window closes. */
  staysOpen: oc.output(type<boolean>()),
  /** A process the backend asked for ended with `code`. */
  processExited: oc
    .input(z.object({ id: z.uuid(), code: z.number().int() }))
    .output(type<void>()),
  /** Stores runs where they stopped and closes what is open, before the app quits. */
  close: oc.output(type<void>()),
};
