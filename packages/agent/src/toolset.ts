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
  let deferred = new Set<string>();
  let installed: Extension[] = [];

  return {
    /**
     * Installs the toolset of the moment: an extension replaces the one installed under its name,
     * and one the toolset dropped is removed.
     */
    async load() {
      const toolset = await read();

      const extensions = [...toolset.offered, ...toolset.deferred];
      const names = new Set(extensions.map((extension) => extension.name));

      // One the host no longer gives, such as the shell once switched off, stops being offered.
      for (const extension of installed) {
        if (!names.has(extension.name)) registry.uninstall(extension);
      }

      for (const extension of extensions) registry.install(extension);

      installed = extensions;

      const toolNames = (from: readonly Extension[]) =>
        from
          .flatMap((extension) => extension.tools ?? [])
          .map((tool) => tool.name);

      offered = toolNames(toolset.offered);
      deferred = new Set(toolNames(toolset.deferred));
    },

    /**
     * Sets what the conversation's next request offers: the offered tools lead, and the deferred
     * tools the conversation already loaded stay after them, while they are still given.
     */
    async offer(tx: Tx, id: ConversationId) {
      const agent = await tx.doc(AgentDoc, id);

      const loaded = Array.isArray(agent.tools)
        ? agent.tools.filter((name) => deferred.has(name))
        : [];

      const tools = [...offered, ...loaded];

      if (!isEqual(agent.tools, tools)) agent.tools = tools;
    },
  };
}
