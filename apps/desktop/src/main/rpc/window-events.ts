import type { SymbolRef } from "@solyx/core/market";

import type { AgentUpdate } from "#shared/agent.ts";
import type { Change } from "#shared/rpc/changes.ts";
import type { Appearance, SignInCode } from "#shared/settings.ts";

/**
 * What the main process tells every window of, by event, through the services' `windowEvents`.
 * Records rather than an interface, since the publisher takes only a record of object payloads.
 */
export type WindowEvents = Record<
  | "agent:store-failed"
  | "backup:changed"
  | "inbox:changed"
  | "market:sources-changed"
  | "memory:changed"
  | "proposals:changed"
  | "research:changed"
  | "schedules:changed"
  | "settings:changed"
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
