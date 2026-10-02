import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { SignInOutcome } from "@solyx/agent/chatgpt-oauth";
import { createMcpHub } from "@solyx/agent/mcp";
import type { McpToolCall } from "@solyx/agent/mcp";
import { mcpToolPolicySchema, parseMcpFile } from "@solyx/agent/mcp-config";
import type { McpToolPolicy } from "@solyx/agent/mcp-config";
import { errorMessage, isErrnoError } from "@solyx/utils/error";
import { watchFile } from "@solyx/utils/server";

import { mcpSecretKey, mcpSignInKey } from "#shared/ipc/settings.ts";
import type { Locale } from "#shared/ipc/settings.ts";

import { PRODUCT_NAME } from "../../product.ts";
import type { ConfigFile } from "../settings/config-file.ts";
import type { SecretStore } from "../settings/secret-store.ts";
import { SignInFlow, signInPage } from "../settings/sign-in-page.ts";

import { loginShellPath } from "./shell-path.ts";

// Long enough for an `npx` server's first start, short enough that a stuck one never holds a run.
const CONNECT_WAIT_MS = 10_000;

const TEMPLATE = `{
  "mcpServers": {}
}
`;

/**
 * The MCP servers in mcp.json beside the config file. Nothing starts until the agent or the
 * settings page first needs them; after that, saved edits reconnect what changed. A file that no
 * longer parses keeps the servers already running and reports why.
 */
export function createMcpServers({
  file,
  config,
  secrets,
  version,
  openExternal,
}: {
  file: string;
  config: ConfigFile;
  secrets: SecretStore;
  version: string;
  /** Opens a server's authorization page in the system browser. */
  openExternal: (url: string) => void;
}) {
  const hub = createMcpHub({
    client: { name: PRODUCT_NAME, version },
    secret: (name) => secrets.get(mcpSecretKey(name)),
    path: loginShellPath(),
    signIns: {
      read: (server) => secrets.get(mcpSignInKey(server)),
      write: (server, value) =>
        value === undefined
          ? secrets.delete(mcpSignInKey(server))
          : secrets.save(mcpSignInKey(server), value),
    },
  });

  let signIn: AbortController | undefined;
  let fileError: string | undefined;
  let started: Promise<void> | undefined;
  let stopWatching: (() => void) | undefined;

  async function load() {
    let text: string;

    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (isErrnoError(error, "ENOENT")) {
        fileError = undefined;
        hub.sync([]);

        return;
      }

      throw error;
    }

    try {
      const entries = parseMcpFile(text);

      fileError = undefined;
      hub.sync(entries);
    } catch (error) {
      fileError = errorMessage(error);
    }
  }

  function start() {
    started ??= load().then(() => {
      stopWatching = watchFile(file, () => void load());
    });

    return started;
  }

  /** Saved policies by tool key; an entry that no longer parses reads as asking. */
  function policies(): Record<string, McpToolPolicy> {
    return Object.fromEntries(
      Object.entries(config.read().agent.mcpTools).flatMap(([key, value]) => {
        const policy = mcpToolPolicySchema.safeParse(value).data;

        return policy ? [[key, policy]] : [];
      })
    );
  }

  return {
    file,
    policies,

    async status() {
      await start();

      return { error: fileError, servers: hub.status() };
    },

    /**
     * The tools of every connected server as the agent's extensions, each asking through `allow` as
     * its policy says. Servers get a moment to connect first.
     */
    async extensions(
      allow: (call: McpToolCall, signal?: AbortSignal) => Promise<boolean>
    ) {
      await start();
      await hub.settled(CONNECT_WAIT_MS);

      return hub.extensions({ policies: policies(), allow });
    },

    reconnect: (name: string) => hub.reconnect(name),

    /**
     * Resolves once the sign-in is saved, or quietly once it is cancelled. A sign-in still open,
     * such as one whose browser page was closed, gives way to the new one.
     */
    async signIn(name: string, locale: Locale) {
      signIn?.abort();

      const controller = new AbortController();

      signIn = controller;

      try {
        await hub.signIn(name, {
          open: openExternal,
          page: (result) =>
            result.ok
              ? signInPage(locale, SignInFlow.Mcp, SignInOutcome.SignedIn)
              : signInPage(
                  locale,
                  SignInFlow.Mcp,
                  SignInOutcome.Failed,
                  result.details ?? result.message
                ),
          signal: controller.signal,
        });
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        if (signIn === controller) signIn = undefined;
      }
    },

    cancelSignIn() {
      signIn?.abort();
    },

    signOut: (name: string) => hub.signOut(name),

    /** Writes an empty server list, so there is a file to open and fill. */
    async create() {
      await mkdir(dirname(file), { recursive: true });

      try {
        await writeFile(file, TEMPLATE, { flag: "wx" });
      } catch (error) {
        // One already there is the user's; leave it as it is.
        if (!isErrnoError(error, "EEXIST")) throw error;
      }
    },

    async close() {
      stopWatching?.();
      await hub.close();
    },
  };
}

export type McpServers = ReturnType<typeof createMcpServers>;
