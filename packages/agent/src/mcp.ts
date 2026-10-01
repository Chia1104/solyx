import { defineExtension } from "@earendil-works/pi-durable";
import type { Extension, ToolRegistration } from "@earendil-works/pi-durable";
import {
  McpAuthRequiredError,
  McpClient,
  StdioTransport,
  StreamableHttpTransport,
  toLlmContent,
} from "@earendil-works/pi-mcp";
import type { McpTransport, Tool } from "@earendil-works/pi-mcp";
import {
  McpOAuthAuthorizationRequiredError,
  McpOAuthProvider,
  MemoryOAuthStateStore,
  OAuthCallbackServer,
  adaptOAuthProvider,
  authorizeMcp,
  parseWwwAuthenticate,
  stepUpScope,
} from "@earendil-works/pi-mcp/oauth";
import type {
  McpOAuthState,
  McpOAuthStateStore,
  OAuthCallbackPage,
  OAuthChallenge,
} from "@earendil-works/pi-mcp/oauth";
import { delay, isEqual, once } from "es-toolkit";
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
  /** A sign-in is saved for this remote server, and its requests carry the grant. */
  signedIn: boolean;
}

/** What an MCP tool is called with, as pi-mcp sends it. */
type McpToolArguments = NonNullable<Parameters<McpClient["callTool"]>[1]>;

/** A call waiting for the user to allow it. */
export interface McpToolCall {
  /** The conversation that made the call, as the runtime names it. */
  sessionId: string;
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
  /** Each remote server's sign-in, as text the host keeps encrypted; writing `undefined` forgets it. */
  signIns: {
    read(server: string): Promise<string | undefined>;
    write(server: string, value: string | undefined): Promise<void>;
  };
}

export interface McpSignInOptions {
  /** Opens the server's authorization page in the system browser. */
  open(url: string): void;
  /** The page the browser lands on when it returns to this computer. */
  page(result: OAuthCallbackPage): string;
  /** Aborting it stops waiting for the browser. */
  signal?: AbortSignal;
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
  /** What the server's last 401 asked for, which points a sign-in at its authorization server. */
  challenge?: OAuthChallenge;
}

const argsSchema = z.record(z.string(), z.unknown());

const STDERR_TAIL = 2000;

// What a sign-in keeps between runs. Discovery is looked up again, and an authorization in
// progress never outlives the sign-in that started it.
const savedSignInSchema = z.object({
  serverUrl: z.string(),
  clientInformation: z
    .object({
      client_id: z.string(),
      client_secret: z.string().optional(),
      client_id_issued_at: z.number().optional(),
      client_secret_expires_at: z.number().optional(),
      token_endpoint_auth_method: z.string().optional(),
      redirect_uris: z.array(z.string()).optional(),
    })
    .optional(),
  tokens: z
    .object({
      access_token: z.string(),
      token_type: z.string(),
      expires_in: z.number().optional(),
      scope: z.string().optional(),
      refresh_token: z.string().optional(),
      id_token: z.string().optional(),
    })
    .optional(),
  tokensExpireAt: z.number().optional(),
});

type SavedSignIn = z.infer<typeof savedSignInSchema>;

// Requests never finish an authorization, so their redirect only names a client registered again
// after the server dropped the old one; the next sign-in registers for its own port.
const UNREGISTERED_REDIRECT = "http://127.0.0.1/callback";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** A server's metadata could name any scheme, and only web pages belong in the browser. */
const browsable = (url: URL) =>
  url.protocol === "https:" ||
  (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));

/** Listens where the saved registration redirects to, or on any free port once that is taken. */
async function listenForCallback(
  saved: SavedSignIn | undefined,
  renderPage: McpSignInOptions["page"]
) {
  const registered = saved?.clientInformation?.redirect_uris?.[0];
  const port = Number(URL.parse(registered ?? "")?.port ?? 0);

  try {
    return await OAuthCallbackServer.listen({ port, renderPage });
  } catch (error) {
    if (port === 0) throw error;

    return OAuthCallbackServer.listen({ renderPage });
  }
}

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

  async function readSignIn(server: string): Promise<SavedSignIn | undefined> {
    const text = await options.signIns.read(server);

    if (text === undefined) return undefined;

    try {
      return savedSignInSchema.safeParse(JSON.parse(text)).data;
    } catch {
      return undefined;
    }
  }

  const writeSignIn = (server: string, state: McpOAuthState) =>
    options.signIns.write(
      server,
      JSON.stringify(savedSignInSchema.parse(state))
    );

  /** Requests read the saved grant and save the one a refresh replaces it with. */
  const savedStore = (server: string): McpOAuthStateStore => ({
    load: () => readSignIn(server),
    save: (state) => writeSignIn(server, state),
  });

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
    name: string,
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
      const saved = await readSignIn(name);

      // A grant holds for the URL it was given for, and refreshing it needs the client registered.
      status.signedIn =
        saved?.serverUrl === String(new URL(config.url)) &&
        saved.tokens !== undefined &&
        saved.clientInformation !== undefined;

      return new StreamableHttpTransport({
        url: config.url,
        headers: resolved,
        authProvider: status.signedIn
          ? adaptOAuthProvider(
              new McpOAuthProvider({
                serverUrl: config.url,
                redirectUrl:
                  saved?.clientInformation?.redirect_uris?.[0] ??
                  UNREGISTERED_REDIRECT,
                clientMetadata: { client_name: options.client.name },
                store: savedStore(name),
                // A grant that can no longer be refreshed waits for the user to sign in again.
                onRedirect: () => undefined,
              })
            )
          : undefined,
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
      signedIn: false,
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
      const transport = await transportFor(name, entry.config, status, stderr);

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

        if (
          error instanceof McpAuthRequiredError ||
          error instanceof McpOAuthAuthorizationRequiredError
        ) {
          connection.challenge =
            error instanceof McpAuthRequiredError
              ? parseWwwAuthenticate(error.wwwAuthenticate)
              : undefined;
          status.state = McpServerState.NeedsSignIn;
          changed();

          return;
        }

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

  /** Starts one server again, as after the user saved a secret it names or signed in to it. */
  function reconnect(name: string) {
    const connection = connections.get(name);

    if (!connection) return;

    connections.set(name, start(connection.entry));
    void stop(connection);
    changed();
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

    reconnect,

    /**
     * Signs in to a remote server in the browser, with PKCE and a client registered with its
     * authorization server, then reconnects it with the grant. A registration is reused while the
     * loopback port it redirects to is free.
     */
    async signIn(name: string, { open, page, signal }: McpSignInOptions) {
      const connection = connections.get(name);

      const config =
        connection && "config" in connection.entry
          ? connection.entry.config
          : undefined;

      if (!connection || config?.kind !== McpTransportKind.Http) {
        throw new Error(`${name} is not a remote server in mcp.json`);
      }

      const saved = await readSignIn(name);
      const callback = await listenForCallback(saved, page);

      // The port frees as soon as closing starts, but the close itself waits for every connection
      // to end, and a browser keeps a spare one open as long as it likes. Nothing waits for it.
      const close = once(() => void callback.close().catch(() => undefined));

      signal?.addEventListener("abort", close, { once: true });

      try {
        // Kept in memory until the grant arrives, so a sign-in that stops halfway changes nothing.
        const store = new MemoryOAuthStateStore();

        if (saved) store.save(saved);

        const provider = new McpOAuthProvider({
          serverUrl: config.url,
          redirectUrl: callback.redirectUrl,
          clientMetadata: { client_name: options.client.name },
          store,
          onRedirect(url) {
            signal?.throwIfAborted();

            if (!browsable(url)) {
              throw new Error(
                `${name} asked to open ${url.protocol} in the browser`
              );
            }

            open(url.href);
          },
        });

        // A client registered for another port would refuse this redirect.
        if (
          !saved?.clientInformation?.redirect_uris?.includes(
            callback.redirectUrl
          )
        ) {
          await provider.invalidateCredentials("client");
        }

        const flow = {
          serverUrl: config.url,
          resourceMetadataUrl: connection.challenge?.resourceMetadataUrl,
          // A challenge may name only the scopes missing, and a grant of just those loses the rest.
          scope: stepUpScope(saved?.tokens?.scope, connection.challenge?.scope),
        };

        const returned = callback.waitForCallback(await provider.state());

        // Settled here too, so a flow that fails before the browser opens leaves nothing unhandled.
        returned.catch(() => undefined);

        await authorizeMcp(provider, { ...flow, skipRefresh: true });

        const { code, iss } = await returned;

        // `iss` lets pi-mcp refuse a code another authorization server sent (RFC 9207).
        await authorizeMcp(provider, {
          ...flow,
          authorizationCode: code,
          iss,
        });

        const granted = store.load();

        if (!granted?.tokens) throw new Error(`${name} granted no tokens`);

        await writeSignIn(name, granted);
      } finally {
        signal?.removeEventListener("abort", close);
        close();
      }

      reconnect(name);
    },

    /** Forgets the server's grant here; the server may still hold it until it expires. */
    async signOut(name: string) {
      await options.signIns.write(name, undefined);
      reconnect(name);
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

    /**
     * Every connected server's tools under their policies. A call cut off by the app exiting runs
     * again only for a tool that may run without asking, which its server marks read-only.
     */
    extension({ policies, allow }: McpToolOptions): Extension {
      const tools: ToolRegistration[] = [];
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
            description: `${tool.description ?? tool.title ?? tool.name}\n(A tool from the ${server} MCP server.)`,
            // Providers require an object schema, and some reject one without properties.
            parameters: {
              ...tool.inputSchema,
              type: "object",
              properties: tool.inputSchema.properties ?? {},
            },
            replay: policy === McpToolPolicy.Auto ? "safe" : "unsafe",
            async execute(params, api, context) {
              const args = argsSchema.parse(params ?? {});
              const signal = context.abortSignal;

              if (
                policy === McpToolPolicy.Ask &&
                !(await allow(
                  {
                    sessionId: String(api.conversationId),
                    toolCallId: api.callId,
                    server,
                    tool: tool.name,
                    args,
                  },
                  signal
                ))
              ) {
                throw new Error("The user did not allow this call");
              }

              try {
                const result = await client.callTool(tool.name, args, {
                  signal,
                });

                // MCP reports a tool's own failure in the result rather than as an error.
                return {
                  content: toLlmContent(result),
                  details: { server, tool: tool.name },
                  isError: result.isError === true,
                };
              } catch (error) {
                if (error instanceof McpOAuthAuthorizationRequiredError) {
                  connection.status.state = McpServerState.NeedsSignIn;
                  changed();
                }

                throw error;
              }
            },
          });
        }
      }

      return defineExtension({ name: "mcp", tools });
    },

    async close() {
      const all = [...connections.values()];

      connections.clear();
      await Promise.all(all.map(stop));
    },
  };
}

export type McpHub = ReturnType<typeof createMcpHub>;
