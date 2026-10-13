import { defineExtension } from "@earendil-works/pi-durable";
import type { Extension } from "@earendil-works/pi-durable";
import { createCodemodeExtension } from "@earendil-works/pi-durable/codemode";

import type { McpExtensions } from "./mcp.ts";
import type { ScriptRunner } from "./script-runner.ts";

const NAME = "mcp-script";

/**
 * `codemode`: pi-durable's code mode, whose scripts call the tools that name scripts among their
 * callers, which are the MCP tools alone, each call under its tool's policy as a direct call is.
 * A script gets no models, and no environment, so what it prints is never written to a file. With
 * no server's tools to call, the agent goes without it.
 */
export function mcpScriptExtension(
  { namespaces }: Pick<McpExtensions, "namespaces">,
  scripts: Pick<ScriptRunner, "sandbox">
): Extension {
  if (namespaces.length === 0) return defineExtension({ name: NAME });

  const codemode = createCodemodeExtension({
    sandbox: scripts.sandbox(),
    namespaces,
    models: false,
  });

  return {
    ...codemode,
    name: NAME,
    tools: codemode.tools?.map((tool) => ({
      ...tool,
      execute: (args, api, context) =>
        tool.execute(args, { ...api, env: undefined }, context),
    })),
  };
}
