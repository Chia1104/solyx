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
 * An extension as the registry holds it. A tool that does not name its callers is the model's
 * alone, so a script reaches only the tools that name scripts; a deferred extension's tools are
 * kept from the model until it loads them.
 */
function installable(extension: Extension, deferred: boolean): Extension {
  return {
    ...extension,
    ...(extension.tools && {
      tools: extension.tools.map((tool) => ({
        ...tool,
        callers: tool.callers ?? ["model"],
        ...(deferred && { deferred: true as const }),
      })),
    }),
  };
}

/**
 * Keeps the registry and each conversation's tools in step with the host's toolset, which `read`
 * builds again at every load, so a run sees the tools of the moment it starts.
 */
export function createToolsetLoader(
  registry: Registry,
  read: () => Promise<Toolset>
) {
  let tools: string[] = [];
  let installed: Extension[] = [];

  return {
    /**
     * Installs the toolset of the moment: an extension replaces the one installed under its name,
     * and one the toolset dropped is removed.
     */
    async load() {
      const toolset = await read();

      const extensions = [
        ...toolset.offered.map((extension) => installable(extension, false)),
        ...toolset.deferred.map((extension) => installable(extension, true)),
      ];

      const names = new Set(extensions.map((extension) => extension.name));

      // One the host no longer gives, such as the shell once switched off, stops being offered.
      for (const extension of installed) {
        if (!names.has(extension.name)) registry.uninstall(extension);
      }

      for (const extension of extensions) registry.install(extension);

      installed = extensions;
      tools = extensions
        .flatMap((extension) => extension.tools ?? [])
        .map((tool) => tool.name);
    },

    /**
     * Enables every tool the host gives for the conversation's next request. Which of the deferred
     * ones the model is offered is pi-durable's to keep, as the conversation loads them.
     */
    async offer(tx: Tx, id: ConversationId) {
      const agent = await tx.doc(AgentDoc, id);

      if (!isEqual(agent.tools, tools)) agent.tools = tools;
    },
  };
}
