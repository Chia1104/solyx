import type { AgentUpdate } from "@solyx/api/agent";
import type { Change } from "@solyx/api/rpc/changes";
import type { Appearance, SignInCode } from "@solyx/api/settings";
import type { SymbolRef } from "@solyx/core/market";

/**
 * What the main process tells every window of, by event, through the services' `windowEvents`.
 * Records rather than an interface, since the publisher takes only a record of object payloads.
 */
export type WindowEvents = Record<
  | "agent:store-failed"
  | "backtests:changed"
  | "backup:changed"
  | "devices:changed"
  | "embeddings:changed"
  | "inbox:changed"
  | "market:sources-changed"
  | "memory:changed"
  | "proposals:changed"
  | "research:changed"
  | "schedules:changed"
  | "settings:changed"
  | "strategies:changed"
  | "themes:changed"
  | "updates:changed"
  | "watchlist:changed"
  | "workspace:changed",
  Change
> &
  Record<"agent:update", AgentUpdate> &
  Record<"news:changed", SymbolRef> &
  Record<"settings:appearance", Appearance> &
  Record<"settings:sign-in-code", SignInCode>;
