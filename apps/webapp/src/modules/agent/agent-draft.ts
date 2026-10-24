import { Pane, useLayoutStore } from "../../app/layout-store.ts";

import { useAgentStore } from "./agent-store.ts";

/** Hands the agent's composer a message to send in a new conversation, opening its pane; the user sends it. */
export function useAgentDraft() {
  const select = useAgentStore((state) => state.select);
  const setDraft = useAgentStore((state) => state.setDraft);
  const agentOpen = useLayoutStore((state) => state.panes[Pane.Agent].open);
  const toggle = useLayoutStore((state) => state.toggle);

  return (text: string) => {
    if (!agentOpen) toggle(Pane.Agent);

    select(null);
    setDraft(text);
  };
}
