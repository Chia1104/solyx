import type { SymbolRef } from "@solyx/core/market";

import { Pane, useLayoutStore } from "../../app/layout-store.ts";
import { AgentTab, useAgentStore } from "../agent/agent-store.ts";

import { useTicketStore } from "./ticket-store.ts";
import type { TicketTab } from "./ticket-store.ts";

/** Brings the order panel into view: the agent pane open on its trading tab. */
export function showTicket() {
  useLayoutStore.getState().show(Pane.Agent);
  useAgentStore.getState().showTab(AgentTab.Proposals);
}

/**
 * Opens the order panel on a sale of `shares` of a listing held, or on an exit of them, for the
 * user to finish and check; nothing is proposed until they do.
 */
export function openSale(symbol: SymbolRef, shares: number, tab: TicketTab) {
  useTicketStore.getState().requestSale(symbol, tab, shares);
  showTicket();
}
