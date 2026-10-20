import { useRouter } from "@tanstack/react-router";

import type { SymbolRef } from "@solyx/core/market";

import { Pane, useLayoutStore } from "../../app/layout-store.ts";
import { AgentTab, useAgentStore } from "../agent/agent-store.ts";

import { useTicketStore } from "./ticket-store.ts";
import type { TicketTab } from "./ticket-store.ts";

/** Brings the order panel into view: the agent pane open on its tab. */
export function showTicket() {
  useLayoutStore.getState().show(Pane.Agent);
  useAgentStore.getState().showTab(AgentTab.Ticket);
}

/**
 * Opens a sale of `shares` of a listing held, or an exit of them, on the listing's page, where the
 * order panel trades it, for the user to finish and check; nothing is proposed until they do.
 */
export function useOpenSale() {
  const router = useRouter();

  return (symbol: SymbolRef, shares: number, tab: TicketTab) => {
    useTicketStore.getState().requestSale(symbol, tab, shares);

    const to = "/symbol/$market/$symbol";
    const params = { market: symbol.market, symbol: symbol.symbol };

    // Moving to the page already open would only add a step to Back.
    if (router.matchRoute({ to, params })) {
      showTicket();

      return;
    }

    // Shown once there, so the panel never comes into view on the page before's listing.
    void router
      .navigate({
        to,
        params,
        // Keeps the chart's interval, as moving between listings does.
        search: true,
      })
      .then(showTicket);
  };
}
