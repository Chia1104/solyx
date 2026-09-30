import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

import { debounce } from "es-toolkit";

import { SignInOutcome } from "@solyx/agent/chatgpt-oauth";
import { createMcpHub } from "@solyx/agent/mcp";
import type { McpToolCall } from "@solyx/agent/mcp";
import { mcpToolPolicySchema, parseMcpFile } from "@solyx/agent/mcp-config";
import type { McpToolPolicy } from "@solyx/agent/mcp-config";

import type { ConfigFile } from "../settings/config-file.ts";
import type { SecretStore } from "../settings/secret-store.ts";

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
  signInPage,
}: {
  file: string;
  config: ConfigFile;
  secrets: SecretStore;
  version: string;
  /** Opens a server's authorization page in the system browser. */
  openExternal: (url: string) => void;
  /** The page the browser lands on once a sign-in returns, in the language it was started in. */
  signInPage: (
    locale: string,
    outcome: SignInOutcome,
    detail?: string
  ) => string;
}) {
  const hub = createMcpHub({
    client: { name: "Solyx", version },
    secret: (name) => secrets.get(`mcp:${name}`),
    path: loginShellPath(),
    signIns: {
      read: (server) => secrets.get(`mcp-oauth:${server}`),
      write: (server, value) =>
        value === undefined
          ? secrets.delete(`mcp-oauth:${server}`)
          : secrets.save(`mcp-oauth:${server}`, value),
    },
  });

  let signIn: AbortController | undefined;
  let fileError: string | undefined;
  let started: Promise<void> | undefined;
  let watcher: FSWatcher | undefined;

  async function load() {
    let text: string;

    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
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
      fileError = error instanceof Error ? error.message : String(error);
    }
  }

  function start() {
    started ??= load().then(() => {
      const reload = debounce(() => void load(), 200);

      // Editors often save by renaming a new file into place, so the folder is watched.
      watcher = watch(dirname(file), (_event, name) => {
        if (name === basename(file)) reload();
      });
    });

    return started;
  }

  /** Saved policies by tool key; an entry that no longer parses reads as asking. */
  function policies(): Record<string, McpToolPolicy> {
    return Object.fromEntries(
      Object.entries(config.read().agent?.mcpTools ?? {}).flatMap(
        ([key, value]) => {
          const policy = mcpToolPolicySchema.safeParse(value).data;

          return policy ? [[key, policy]] : [];
        }
      )
    );
  }

  return {
    file,
    policies,

    async status() {
      await start();

      return { error: fileError, servers: hub.status() };
    },

    /** The tools of every connected server for one run, each asking through `allow` as its policy says. */
    async tools(
      allow: (call: McpToolCall, signal?: AbortSignal) => Promise<boolean>
    ) {
      await start();
      await hub.settled(CONNECT_WAIT_MS);

      return hub.tools({ policies: policies(), allow });
    },

    reconnect: (name: string) => hub.reconnect(name),

    /** Resolves once the sign-in is saved, or quietly once it is cancelled. */
    async signIn(name: string, locale: string) {
      if (signIn) throw new Error("A sign-in is already open");

      const controller = new AbortController();

      signIn = controller;

      try {
        await hub.signIn(name, {
          open: openExternal,
          page: (result) =>
            result.ok
              ? signInPage(locale, SignInOutcome.SignedIn)
              : signInPage(
                  locale,
                  SignInOutcome.Failed,
                  result.details ?? result.message
                ),
          signal: controller.signal,
        });
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        signIn = undefined;
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
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "EEXIST"
          )
        ) {
          throw error;
        }
      }
    },

    async close() {
      watcher?.close();
      await hub.close();
    },
  };
}

export type McpServers = ReturnType<typeof createMcpServers>;
