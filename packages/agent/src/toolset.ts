import { AgentDoc } from "@earendil-works/pi-durable";
import type {
  ConversationId,
  Extension,
  Registry,
  Tx,
} from "@earendil-works/pi-durable";
import { isEqual } from "es-toolkit";

/** The extensions a host gives the agent at one moment. */
export interface Toolset {
  /** Extensions whose tools and prompt sections ride every request. */
  offered: readonly Extension[];
  /** Extensions whose tools wait until the agent loads them into its conversation. */
  deferred: readonly Extension[];
}

/**
 * Keeps the registry and each conversation's tools in step with the host's toolset, which `read`
 * builds again at every load, so a run sees the tools of the moment it starts.
 */
export function createToolsetLoader(
  registry: Registry,
  read: () => Promise<Toolset>
) {
  let offered: string[] = [];

  return {
    /** Installs the toolset of the moment; an extension replaces the one installed under its name. */
    async load() {
      const toolset = await read();

      for (const extension of [...toolset.offered, ...toolset.deferred]) {
        registry.install(extension);
      }

      offered = toolset.offered
        .flatMap((extension) => extension.tools ?? [])
        .map((tool) => tool.name);
    },

    /**
     * Sets what the conversation's next request offers: the offered tools lead, and the deferred
     * tools the conversation already loaded stay after them.
     */
    async offer(tx: Tx, id: ConversationId) {
      const agent = await tx.doc(AgentDoc, id);

      const loaded = Array.isArray(agent.tools)
        ? agent.tools.filter((name) => !offered.includes(name))
        : [];

      const tools = [...offered, ...loaded];

      if (!isEqual(agent.tools, tools)) agent.tools = tools;
    },
  };
}
