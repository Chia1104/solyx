import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import * as z from "zod";

const rpcSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
});

const registrationSchema = z.object({ redirect_uris: z.array(z.string()) });

interface Authorization {
  clientId: string;
  redirectUri: string;
  challenge: string;
}

async function body(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) chunks.push(Buffer.from(chunk));

  return Buffer.concat(chunks).toString("utf8");
}

function json<Body>(response: ServerResponse, status: number, value: Body) {
  response
    .writeHead(status, { "content-type": "application/json" })
    .end(JSON.stringify(value));
}

function resultOf(method: string, token: string) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "oauth-fake", version: "0.0.0" },
      };
    case "tools/list":
      return {
        tools: [
          {
            name: "whoami",
            inputSchema: { type: "object" },
            annotations: { readOnlyHint: true },
          },
        ],
      };
    default:
      return { content: [{ type: "text", text: `token=${token}` }] };
  }
}

const s256 = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

/**
 * A remote MCP server behind its own OAuth authorization server, as the MCP spec lays out:
 * protected resource metadata, dynamic client registration, PKCE and refresh tokens. Its one
 * tool answers with the token it was called with.
 */
export async function startOAuthMcpServer() {
  const clients = new Map<string, string[]>();
  const codes = new Map<string, Authorization>();
  const accessTokens = new Set<string>();
  const refreshTokens = new Set<string>();
  let issued = 0;

  // A handler that throws fails the test that reached it.
  const server = createServer((request, response) => {
    void handle(request, response);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  // SAFETY: a server listening on a host and port has a TCP address.
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  function grant() {
    issued += 1;

    const tokens = {
      access_token: `access-${issued}`,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: `refresh-${issued}`,
    };

    accessTokens.add(tokens.access_token);
    refreshTokens.add(tokens.refresh_token);

    return tokens;
  }

  async function mcp(request: IncomingMessage, response: ServerResponse) {
    const token = request.headers.authorization?.replace(/^Bearer /, "");

    if (!token || !accessTokens.has(token)) {
      response
        .writeHead(401, {
          "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
        })
        .end();

      return;
    }

    if (request.method !== "POST") {
      response.writeHead(405).end();

      return;
    }

    const { id, method } = rpcSchema.parse(JSON.parse(await body(request)));

    if (id === undefined) {
      response.writeHead(202).end();

      return;
    }

    json(response, 200, {
      jsonrpc: "2.0",
      id,
      result: resultOf(method, token),
    });
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", base);

    switch (url.pathname) {
      case "/mcp":
        return mcp(request, response);

      case "/.well-known/oauth-protected-resource/mcp":
        return json(response, 200, {
          resource: `${base}/mcp`,
          authorization_servers: [base],
        });

      case "/.well-known/oauth-authorization-server":
        return json(response, 200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        });

      case "/register": {
        const { redirect_uris } = registrationSchema.parse(
          JSON.parse(await body(request))
        );

        const clientId = `client-${clients.size + 1}`;

        clients.set(clientId, redirect_uris);

        return json(response, 201, {
          client_id: clientId,
          redirect_uris,
          token_endpoint_auth_method: "none",
        });
      }

      // Stands in for the consent page: the user allows at once.
      case "/authorize": {
        const clientId = url.searchParams.get("client_id") ?? "";
        const redirectUri = url.searchParams.get("redirect_uri") ?? "";

        if (!clients.get(clientId)?.includes(redirectUri)) {
          return json(response, 400, { error: "invalid_request" });
        }

        const code = `code-${codes.size + 1}`;

        codes.set(code, {
          clientId,
          redirectUri,
          challenge: url.searchParams.get("code_challenge") ?? "",
        });

        const back = new URL(redirectUri);

        back.searchParams.set("code", code);
        back.searchParams.set("state", url.searchParams.get("state") ?? "");
        response.writeHead(302, { location: back.href }).end();

        return;
      }

      case "/token": {
        const form = new URLSearchParams(await body(request));

        if (form.get("grant_type") === "refresh_token") {
          const refresh = form.get("refresh_token") ?? "";

          if (!refreshTokens.delete(refresh)) {
            return json(response, 400, { error: "invalid_grant" });
          }

          return json(response, 200, grant());
        }

        const authorization = codes.get(form.get("code") ?? "");

        if (
          !authorization ||
          authorization.clientId !== form.get("client_id") ||
          authorization.redirectUri !== form.get("redirect_uri") ||
          authorization.challenge !== s256(form.get("code_verifier") ?? "")
        ) {
          return json(response, 400, { error: "invalid_grant" });
        }

        codes.delete(form.get("code") ?? "");

        return json(response, 200, grant());
      }

      default:
        return json(response, 404, { error: "not_found" });
    }
  }

  return {
    url: `${base}/mcp`,
    /** Clients registered so far. */
    registrations: () => clients.size,
    /** Every access token stops working, as when they expire. */
    expireAccessTokens: () => accessTokens.clear(),
    /** Every grant stops working, as when the user revokes the app. */
    revoke() {
      accessTokens.clear();
      refreshTokens.clear();
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Plays the browser: opens the authorization page and follows its redirect back to the app. */
export async function browse(url: string) {
  const consent = await fetch(url, { redirect: "manual" });
  const back = consent.headers.get("location");

  if (!back) throw new Error(`No redirect from ${url}: ${consent.status}`);

  return (await fetch(back)).text();
}
