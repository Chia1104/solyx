import { DestinationKind } from "@solyx/api/workspace";
import type { Destination } from "@solyx/api/workspace";

import { Pane, useLayoutStore } from "../../app/layout-store.ts";
import { router } from "../../app/router.tsx";
import { client, forEachEvent } from "../../app/rpc.ts";
import { AgentTab, useAgentStore } from "../agent/agent-store.ts";

/** Shows a place in the workspace, as one the main process asks for. */
export function showDestination(destination: Destination) {
  switch (destination.kind) {
    case DestinationKind.Proposals:
      useLayoutStore.getState().show(Pane.Agent);
      useAgentStore.getState().showTab(AgentTab.Proposals);
      break;
    case DestinationKind.Conversation:
      useLayoutStore.getState().show(Pane.Agent);
      useAgentStore.getState().select(destination.sessionId);
      useAgentStore.getState().showTab(AgentTab.Chat);
      break;
    case DestinationKind.Settings:
      void router.navigate({
        to: "/settings",
        search: { section: destination.section },
      });
  }
}

/** Shows each place the main process asks for, such as the one a row of the tray's menu names. */
export function followDestinations() {
  const take = async () => {
    const destination = await client.workspace.takeDestination();

    if (destination) showDestination(destination);
  };

  void forEachEvent(client.workspace.changes(), () => void take());

  // One asked for while this window was still loading waits to be taken.
  void take();
}
