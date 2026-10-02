import { create } from "zustand";

interface AgentState {
  /**
   * The conversation on screen. `undefined` follows the most recent one; `null` is a new
   * conversation that starts with its first message.
   */
  selected: string | null | undefined;
  select: (id: string | null) => void;
  /** The listing the user chose not to send; a different listing on screen is attached again. */
  detachedFocus: string | null;
  setDetachedFocus: (key: string | null) => void;
  /** Text a message handed back to the composer, which takes it once. */
  draft: string | null;
  setDraft: (text: string | null) => void;
}

export const useAgentStore = create<AgentState>()((set) => ({
  selected: undefined,
  select: (id) => set({ selected: id }),
  detachedFocus: null,
  setDetachedFocus: (key) => set({ detachedFocus: key }),
  draft: null,
  setDraft: (text) => set({ draft: text }),
}));
