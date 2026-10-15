import type { SymbolRef } from "@solyx/core/market";

import type { Change } from "#shared/rpc/changes.ts";

/**
 * What the main process tells every window of, by event, through the services' `windowEvents`.
 * Records rather than an interface, since the publisher takes only a record of object payloads.
 */
export type WindowEvents = Record<
  | "backup:changed"
  | "inbox:changed"
  | "memory:changed"
  | "proposals:changed"
  | "research:changed"
  | "schedules:changed"
  | "themes:changed"
  | "updates:changed"
  | "watchlist:changed"
  | "workspace:changed",
  Change
> &
  Record<"news:changed", SymbolRef>;
