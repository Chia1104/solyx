import { create } from "zustand";

import type { AgentModelPick } from "@solyx/agent/providers";
import { ApprovalMode } from "@solyx/agent/wire";

/** The agent pane's tabs. */
export const AgentTab = {
  Chat: "chat",
  Proposals: "proposals",
} as const;

export type AgentTab = (typeof AgentTab)[keyof typeof AgentTab];

/** What a new conversation starts on, held until its first message creates it. */
export interface UnstartedSetup {
  /** The model last picked in any conversation, so a new one keeps it. */
  pick: AgentModelPick;
  /** Picked for this conversation alone, since letting calls run unasked never carries over. */
  approvalMode: ApprovalMode;
}

interface AgentState {
  /**
   * The conversation on screen. `undefined` follows the most recent one; `null` is a new
   * conversation that starts with its first message.
   */
  selected: string | null | undefined;
  select: (id: string | null) => void;
  /** The agent pane's tab on screen. */
  tab: AgentTab;
  showTab: (tab: AgentTab) => void;
  /** The listing the user chose not to send; a different listing on screen is attached again. */
  detachedFocus: string | null;
  setDetachedFocus: (key: string | null) => void;
  /** Text a message handed back to the composer, which takes it once. */
  draft: string | null;
  setDraft: (text: string | null) => void;
  unstarted: UnstartedSetup;
  setUnstarted: (change: Partial<UnstartedSetup>) => void;
}

export const useAgentStore = create<AgentState>()((set) => ({
  selected: undefined,
  select: (id) => set({ selected: id }),
  tab: AgentTab.Chat,
  showTab: (tab) => set({ tab }),
  detachedFocus: null,
  setDetachedFocus: (key) => set({ detachedFocus: key }),
  draft: null,
  setDraft: (text) => set({ draft: text }),
  unstarted: {
    pick: { model: null, thinking: null },
    approvalMode: ApprovalMode.Ask,
  },
  setUnstarted: (change) =>
    set((state) => ({ unstarted: { ...state.unstarted, ...change } })),
}));
