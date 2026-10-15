import type { SettingsSection } from "./settings-section.ts";

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
