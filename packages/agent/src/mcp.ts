import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  McpClient,
  StdioTransport,
  StreamableHttpTransport,
  toLlmContent,
} from "@earendil-works/pi-mcp";
import type { McpTransport, Tool } from "@earendil-works/pi-mcp";
import { delay, isEqual } from "es-toolkit";
import * as z from "zod";

import {
  McpServerState,
  McpToolPolicy,
  McpTransportKind,
  mcpToolKey,
  secretReference,
} from "./mcp-config.ts";
import type { McpServerConfig, McpServerEntry } from "./mcp-config.ts";

export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  /** The server marks it read-only; only such tools may run without asking. */
  readOnly: boolean;
}

export interface McpServerStatus {
  name: string;
  kind: McpTransportKind;
  /** The command line or URL, so the user recognizes the entry. */
  target: string;
  state: McpServerState;
  error?: string;
  tools: McpToolInfo[];
  /** Secrets the entry names as `secret:NAME`. */
  secrets: string[];
  /** Those of them not saved yet. */
  missingSecrets: string[];
}

/** What an MCP tool is called with, as pi-mcp sends it. */
type McpToolArguments = NonNullable<Parameters<McpClient["callTool"]>[1]>;

/** A call waiting for the user to allow it. */
export interface McpToolCall {
  toolCallId: string;
  server: string;
  tool: string;
  args: McpToolArguments;
}

export interface McpHubOptions {
  client: { name: string; version: string };
  /** A secret the user saved, by the name an entry references. */
  secret(name: string): Promise<string | undefined>;
  /** The PATH stdio servers start with, since apps opened from the Dock do not get the shell's. */
  path(): Promise<string | undefined>;
  /** A server connected, failed or changed its tools. */
  onStatus?(): void;
}

export interface McpToolOptions {
  /** Saved policies by `mcpToolKey`; a tool without one is asked about. */
  policies: Readonly<Record<string, McpToolPolicy>>;
  /** Resolves whether the user allows the call; aborting `signal` withdraws the question. */
  allow(call: McpToolCall, signal?: AbortSignal): Promise<boolean>;
}

interface Connection {
  entry: McpServerEntry;
  status: McpServerStatus;
  client?: McpClient;
  tools: Tool[];
  started: Promise<void>;
}

const argsSchema = z.record(z.string(), z.unknown());

const STDERR_TAIL = 2000;

// Providers accept at most 64 characters of [A-Za-z0-9_-] in a tool name.
const toolName = (server: string, tool: string) =>
  `mcp_${server}_${tool}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);

/** The policy a tool actually runs under: `auto` holds only for tools marked read-only. */
export function effectivePolicy(
  saved: McpToolPolicy | undefined,
  readOnly: boolean
): McpToolPolicy {
  if (saved === McpToolPolicy.Auto && !readOnly) return McpToolPolicy.Ask;

  return saved ?? McpToolPolicy.Ask;
}

/**
 * The MCP servers the user listed, kept connected through pi-mcp. An entry whose settings change
 * reconnects; one that fails stays failed with its reason until its entry or secrets change.
 */
export function createMcpHub(options: McpHubOptions) {
  const connections = new Map<string, Connection>();

  const changed = () => options.onStatus?.();

  async function resolve(values: Record<string, string> | undefined) {
    const resolved: Record<string, string> = {};
    const missing: string[] = [];

    for (const [key, value] of Object.entries(values ?? {})) {
      const name = secretReference(value);

      if (!name) {
        resolved[key] = value;
      } else {
        const secret = await options.secret(name);

        if (secret === undefined) missing.push(name);
        else resolved[key] = secret;
      }
    }

    return { resolved, missing };
  }

  async function transportFor(
    config: McpServerConfig,
    status: McpServerStatus,
    stderr: { tail: string }
  ): Promise<McpTransport | undefined> {
    const { resolved, missing } = await resolve(
      config.kind === McpTransportKind.Stdio ? config.env : config.headers
    );

    if (missing.length > 0) {
      status.missingSecrets = missing;
      status.state = McpServerState.Failed;
      status.error = `Save the secrets it names: ${missing.join(", ")}`;

      return undefined;
    }

    if (config.kind === McpTransportKind.Http) {
      return new StreamableHttpTransport({
        url: config.url,
        headers: resolved,
      });
    }

    const path = await options.path();

    return new StdioTransport({
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: path ? { PATH: path, ...resolved } : resolved,
      stderr: "pipe",
      onStderr: (chunk) => {
        stderr.tail = (stderr.tail + chunk).slice(-STDERR_TAIL);
      },
    });
  }

  function start(entry: McpServerEntry): Connection {
    const { name } = entry;
    const config = "config" in entry ? entry.config : undefined;

    const status: McpServerStatus = {
      name,
      kind: config?.kind ?? McpTransportKind.Stdio,
      target: !config
        ? ""
        : config.kind === McpTransportKind.Stdio
          ? [config.command, ...(config.args ?? [])].join(" ")
          : config.url,
      state: McpServerState.Connecting,
      tools: [],
      secrets: Object.values(
        (config?.kind === McpTransportKind.Stdio
          ? config.env
          : config?.headers) ?? {}
      ).flatMap((value) => secretReference(value) ?? []),
      missingSecrets: [],
    };

    const connection: Connection = {
      entry,
      status,
      tools: [],
      started: Promise.resolve(),
    };

    const isCurrent = () => connections.get(name) === connection;

    const fail = (message: string) => {
      status.state = McpServerState.Failed;
      status.error = message;
      changed();
    };

    async function run() {
      if ("error" in entry) {
        fail(entry.error);

        return;
      }

      const stderr = { tail: "" };
      const transport = await transportFor(entry.config, status, stderr);

      if (!transport) {
        changed();

        return;
      }

      const client = new McpClient(options.client);

      connection.client = client;

      try {
        await client.connect(transport);

        const listTools = async () => {
          connection.tools = await client.listTools();
          status.tools = connection.tools.map((tool) => ({
            name: tool.name,
            title: tool.title ?? tool.annotations?.title,
            description: tool.description,
            readOnly: tool.annotations?.readOnlyHint === true,
          }));
        };

        await listTools();

        client.onNotification("notifications/tools/list_changed", () => {
          void listTools().then(changed, () => undefined);
        });

        client.onClose(() => {
          if (isCurrent() && status.state === McpServerState.Connected) {
            fail("The server closed the connection");
          }
        });

        status.state = McpServerState.Connected;
        status.error = undefined;
        changed();
      } catch (error) {
        await client.close().catch(() => undefined);

        const [lastLine] = stderr.tail.trim().split("\n").slice(-1);
        const message = error instanceof Error ? error.message : String(error);

        fail(lastLine ? `${message}: ${lastLine}` : message);
      }
    }

    // A connection replaced before it finished is closed by whoever replaced it.
    connection.started = run().then(() => {
      if (!isCurrent()) void connection.client?.close();
    });

    return connection;
  }

  async function stop(connection: Connection) {
    await connection.started;
    await connection.client?.close().catch(() => undefined);
  }

  return {
    /** Connects entries that are new or changed and closes those that are gone. */
    sync(entries: readonly McpServerEntry[]) {
      const wanted = new Map(entries.map((entry) => [entry.name, entry]));

      for (const [name, connection] of connections) {
        if (!isEqual(connection.entry, wanted.get(name))) {
          connections.delete(name);
          void stop(connection);
        }
      }

      for (const entry of entries) {
        if (!connections.has(entry.name)) {
          connections.set(entry.name, start(entry));
        }
      }

      changed();
    },

    /** Starts one server again, as after the user saved a secret it names. */
    reconnect(name: string) {
      const connection = connections.get(name);

      if (!connection) return;

      connections.set(name, start(connection.entry));
      void stop(connection);
      changed();
    },

    /** Waits until every server has connected or failed, or `timeoutMs` has passed. */
    async settled(timeoutMs: number) {
      await Promise.race([
        Promise.allSettled([...connections.values()].map((c) => c.started)),
        delay(timeoutMs),
      ]);
    },

    status: (): McpServerStatus[] =>
      [...connections.values()].map((connection) =>
        structuredClone(connection.status)
      ),

    /** Every connected server's tools under their policies, for one run. */
    tools({ policies, allow }: McpToolOptions): AgentTool[] {
      const tools: AgentTool[] = [];
      const names = new Set<string>();

      for (const [server, connection] of connections) {
        const { client } = connection;

        if (!client || connection.status.state !== McpServerState.Connected) {
          continue;
        }

        for (const tool of connection.tools) {
          const readOnly = tool.annotations?.readOnlyHint === true;

          const policy = effectivePolicy(
            policies[mcpToolKey(server, tool.name)],
            readOnly
          );

          const name = toolName(server, tool.name);

          if (policy === McpToolPolicy.Off || names.has(name)) continue;

          names.add(name);
          tools.push({
            name,
            label: `${server} · ${tool.title ?? tool.name}`,
            description: `${tool.description ?? tool.title ?? tool.name}\n(A tool from the ${server} MCP server.)`,
            // Providers require an object schema, and some reject one without properties.
            parameters: {
              ...tool.inputSchema,
              type: "object",
              properties: tool.inputSchema.properties ?? {},
            },
            async execute(toolCallId, params, signal) {
              const args = argsSchema.parse(params ?? {});

              if (
                policy === McpToolPolicy.Ask &&
                !(await allow(
                  { toolCallId, server, tool: tool.name, args },
                  signal
                ))
              ) {
                throw new Error("The user did not allow this call");
              }

              const result = await client.callTool(tool.name, args, { signal });

              // MCP reports a tool's own failure in the result rather than as an error.
              return {
                content: toLlmContent(result),
                details: { server, tool: tool.name },
                isError: result.isError === true,
              };
            },
          });
        }
      }

      return tools;
    },

    async close() {
      const all = [...connections.values()];

      connections.clear();
      await Promise.all(all.map(stop));
    },
  };
}

export type McpHub = ReturnType<typeof createMcpHub>;
