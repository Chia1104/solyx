import type { Change } from "#shared/rpc/changes.ts";

/**
 * What the main process tells every window of, by event, through the services' `windowEvents`.
 * A record rather than an interface, since the publisher takes only a record of object payloads.
 */
export type WindowEvents = Record<
  "inbox:changed" | "proposals:changed",
  Change
>;
