import type { SettingsSection } from "../settings-section.ts";

export const DestinationKind = {
  /** The proposals waiting for the user to confirm them. */
  Proposals: "proposals",
  Conversation: "conversation",
  Settings: "settings",
} as const;

export type DestinationKind =
  (typeof DestinationKind)[keyof typeof DestinationKind];

/** A place in the workspace the main process may ask a window to show, as a row of the tray's menu does. */
export type Destination =
  | { kind: typeof DestinationKind.Proposals }
  | { kind: typeof DestinationKind.Conversation; sessionId: string }
  | { kind: typeof DestinationKind.Settings; section: SettingsSection };

export interface WorkspaceApi {
  /** The place the main process last asked for, handed over once; `null` when none waits. */
  takeDestination(): Promise<Destination | null>;
}

/** Pushes from the main process; each subscription returns a function that stops listening. */
export interface WorkspaceEvents {
  /** The main process asked for a place, which `takeDestination` hands over. */
  onDestination(listener: () => void): () => void;
}

export const workspaceChannels = {
  takeDestination: "workspace:take-destination",
} as const satisfies Record<keyof WorkspaceApi, string>;

export const workspaceEvents = {
  onDestination: "workspace:destination",
} as const satisfies Record<keyof WorkspaceEvents, string>;
