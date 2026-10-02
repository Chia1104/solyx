import { create } from "zustand";

interface AgentState {
  /**
   * The conversation on screen. `undefined` follows the most recent one; `null` is a new
   * conversation that starts with its first message.
   */
  selected: string | null | undefined;
  select: (id: string | null) => void;
}

export const useAgentStore = create<AgentState>()((set) => ({
  selected: undefined,
  select: (id) => set({ selected: id }),
}));
