import * as z from "zod";

import { errorMessage } from "@solyx/utils/error";

/** How a tool from an MCP server reaches the agent. */
export const McpToolPolicy = {
  Off: "off",
  /** Offered, and each call waits for the user to allow it. */
  Ask: "ask",
  /** Offered and run without asking; only for tools their server marks read-only. */
  Auto: "auto",
} as const;

export type McpToolPolicy = (typeof McpToolPolicy)[keyof typeof McpToolPolicy];

export const mcpToolPolicySchema = z.enum(McpToolPolicy);

export const McpServerState = {
  Connecting: "connecting",
  Connected: "connected",
  /** A remote server that waits for the user to sign in to it in the browser. */
  NeedsSignIn: "needs-sign-in",
  Failed: "failed",
} as const;

export type McpServerState =
  (typeof McpServerState)[keyof typeof McpServerState];

export const McpTransportKind = {
  Stdio: "stdio",
  Http: "http",
} as const;

export type McpTransportKind =
  (typeof McpTransportKind)[keyof typeof McpTransportKind];

const SECRET_PREFIX = "secret:";

/** Names a secret saved in the app; the mcp.json value `secret:NAME` stands in for it. */
export const mcpSecretNameSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/);

/** The secret an env or header value names instead of holding, if it names one. */
export function secretReference(value: string): string | undefined {
  if (!value.startsWith(SECRET_PREFIX)) return undefined;

  return mcpSecretNameSchema.safeParse(value.slice(SECRET_PREFIX.length)).data;
}

const valuesSchema = z.record(z.string(), z.string());

/**
 * What the server offers, in the user's words, which names it to the agent. One that does not
 * parse reads as absent rather than failing the entry.
 */
const descriptionSchema = z.string().trim().min(1).optional().catch(undefined);

// Loose, since the same file often carries keys other clients read, such as pi's `transport`.
const mcpServerSchema = z.union([
  z
    .looseObject({
      command: z.string().min(1),
      args: z.array(z.string()).optional(),
      env: valuesSchema.optional(),
      cwd: z.string().optional(),
      description: descriptionSchema,
    })
    .transform(({ command, args, env, cwd, description }) => ({
      kind: McpTransportKind.Stdio,
      command,
      args,
      env,
      cwd,
      description,
    })),
  z
    .looseObject({
      url: z.url(),
      headers: valuesSchema.optional(),
      description: descriptionSchema,
    })
    .transform(({ url, headers, description }) => ({
      kind: McpTransportKind.Http,
      url,
      headers,
      description,
    })),
]);

export type McpServerConfig = z.output<typeof mcpServerSchema>;

/** One server in mcp.json: its settings, or why they did not parse. */
export type McpServerEntry =
  | { name: string; config: McpServerConfig }
  | { name: string; error: string };

const fileSchema = z.object({
  mcpServers: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Reads mcp.json in the `mcpServers` shape Claude, Cursor and pi share. Each entry is checked on
 * its own, so one bad entry leaves the others in force.
 */
export function parseMcpFile(text: string): McpServerEntry[] {
  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`mcp.json is not valid JSON: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  const file = fileSchema.safeParse(json);

  if (!file.success) {
    throw new Error(
      `mcp.json needs an mcpServers object: ${z.prettifyError(file.error)}`
    );
  }

  return Object.entries(file.data.mcpServers).map(([name, entry]) => {
    const parsed = mcpServerSchema.safeParse(entry);

    return parsed.success
      ? { name, config: parsed.data }
      : {
          name,
          error: `Needs a command for a local server or a url for a remote one: ${z.prettifyError(parsed.error)}`,
        };
  });
}

/** The key a tool's policy is saved under in the config file. */
export const mcpToolKey = (server: string, tool: string) => `${server}/${tool}`;

/** The policy a tool actually runs under: `auto` holds only for tools marked read-only. */
export function effectivePolicy(
  saved: McpToolPolicy | undefined,
  readOnly: boolean
): McpToolPolicy {
  if (saved === McpToolPolicy.Auto && !readOnly) return McpToolPolicy.Ask;

  return saved ?? McpToolPolicy.Ask;
}
