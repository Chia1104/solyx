import { connect } from "node:net";
import type { Socket } from "node:net";
import { fileURLToPath } from "node:url";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { contentText } from "@earendil-works/pi-ai";
import type {
  ToolExecutionApi,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import {
  McpServerState,
  McpToolPolicy,
  McpTransportKind,
  parseMcpFile,
} from "../src/mcp-config.ts";
import { createMcpHub, effectivePolicy } from "../src/mcp.ts";
import type {
  McpHub,
  McpSignInOptions,
  McpToolCall,
  McpToolOptions,
} from "../src/mcp.ts";

import { browse, startOAuthMcpServer } from "./fixtures/oauth-mcp-server.ts";

const SERVER = fileURLToPath(
  new URL("fixtures/mcp-server.mjs", import.meta.url)
);

const hubs: McpHub[] = [];

const toolsOf = (hub: McpHub, options: McpToolOptions) =>
  hub.extension(options).tools ?? [];

/** Runs a tool as pi-durable would, for call `callId` in conversation 7. */
function call(
  tool: ToolRegistration | undefined,
  args: McpToolCall["args"],
  callId = "call-1"
) {
  if (!tool) throw new Error("No such tool");

  // SAFETY: MCP tools read only the call's id and conversation from their api.
  const api = { callId, conversationId: 7 } as ToolExecutionApi;

  return tool.execute(args, api, BACKGROUND_CONTEXT);
}

afterEach(async () => {
  await Promise.all(hubs.splice(0).map((hub) => hub.close()));
});

function setup(
  secrets: Record<string, string> = { fake: "s3cret" },
  signIns = new Map<string, string>()
) {
  const hub = createMcpHub({
    client: { name: "solyx-test", version: "0.0.0" },
    secret: async (name) => secrets[name],
    path: async () => undefined,
    signIns: {
      read: async (server) => signIns.get(server),
      async write(server, value) {
        if (value === undefined) signIns.delete(server);
        else signIns.set(server, value);
      },
    },
  });

  hubs.push(hub);

  return hub;
}

const fakeServer = (
  env: Record<string, string> = { FAKE_KEY: "secret:fake" }
) =>
  parseMcpFile(
    JSON.stringify({
      mcpServers: { fake: { command: process.execPath, args: [SERVER], env } },
    })
  );

describe("mcp.json", () => {
  test("local and remote servers parse, a broken entry fails on its own", () => {
    const entries = parseMcpFile(
      JSON.stringify({
        mcpServers: {
          local: { command: "npx", args: ["-y", "server"], transport: "stdio" },
          remote: {
            url: "https://mcp.example.com/mcp",
            headers: { Authorization: "secret:token" },
          },
          broken: { args: ["no command"] },
        },
      })
    );

    expect(entries).toMatchObject([
      {
        name: "local",
        config: { kind: McpTransportKind.Stdio, command: "npx" },
      },
      { name: "remote", config: { kind: McpTransportKind.Http } },
      { name: "broken", error: expect.stringContaining("command") },
    ]);
  });

  test("a file that is not JSON is reported", () => {
    expect(() => parseMcpFile("{ mcpServers: ")).toThrow("not valid JSON");
  });
});

test("auto only holds for tools the server marks read-only", () => {
  expect(effectivePolicy(McpToolPolicy.Auto, true)).toBe(McpToolPolicy.Auto);
  expect(effectivePolicy(McpToolPolicy.Auto, false)).toBe(McpToolPolicy.Ask);
  expect(effectivePolicy(undefined, true)).toBe(McpToolPolicy.Ask);
});

describe("a connected server", () => {
  test("lists its tools and runs a call once the user allows it, with its secret in place", async () => {
    const hub = setup();

    hub.sync(fakeServer());
    await hub.settled(10_000);

    expect(hub.status()).toMatchObject([
      {
        name: "fake",
        state: McpServerState.Connected,
        tools: [
          { name: "quote", readOnly: true },
          { name: "order", readOnly: false },
        ],
      },
    ]);

    const allow = vi.fn(async () => true);
    const tools = toolsOf(hub, { policies: {}, allow });
    const quote = tools.find((tool) => tool.name === "mcp_fake_quote");
    const result = await call(quote, { symbol: "2330" });

    expect(allow).toHaveBeenCalledWith(
      {
        sessionId: "7",
        toolCallId: "call-1",
        server: "fake",
        tool: "quote",
        args: { symbol: "2330" },
      },
      undefined
    );
    expect(contentText(result?.content ?? [])).toBe(
      'quote {"symbol":"2330"} key=s3cret'
    );
  });

  test("a refused call never reaches the server", async () => {
    const hub = setup();

    hub.sync(fakeServer());
    await hub.settled(10_000);

    const order = toolsOf(hub, {
      policies: {},
      allow: async () => false,
    }).find((tool) => tool.name === "mcp_fake_order");

    await expect(call(order, {})).rejects.toThrow("did not allow");
  });

  test("policies decide what is offered and what still asks", async () => {
    const hub = setup();

    hub.sync(fakeServer());
    await hub.settled(10_000);

    const allow = vi.fn(async () => true);

    const tools = toolsOf(hub, {
      policies: {
        "fake/quote": McpToolPolicy.Auto,
        "fake/order": McpToolPolicy.Auto,
      },
      allow,
    });

    const quote = tools.find((tool) => tool.name === "mcp_fake_quote");
    const order = tools.find((tool) => tool.name === "mcp_fake_order");

    await call(quote, { symbol: "X" }, "a");
    expect(allow).not.toHaveBeenCalled();

    // Marked auto, but not read-only, so it still asks.
    await call(order, {}, "b");
    expect(allow).toHaveBeenCalledOnce();

    // Only a call that ran without asking may run again after a restart.
    expect(quote?.replay).toBe("safe");
    expect(order?.replay).toBe("unsafe");

    expect(
      toolsOf(hub, {
        policies: { "fake/order": McpToolPolicy.Off },
        allow,
      }).map((tool) => tool.name)
    ).toEqual(["mcp_fake_quote"]);
  });
});

test("a server whose secret is not saved fails and names it", async () => {
  const hub = setup({});

  hub.sync(fakeServer());
  await hub.settled(10_000);

  expect(hub.status()).toMatchObject([
    { state: McpServerState.Failed, missingSecrets: ["fake"] },
  ]);
  expect(toolsOf(hub, { policies: {}, allow: async () => true })).toEqual([]);
});

test("a server taken out of mcp.json is disconnected", async () => {
  const hub = setup();

  hub.sync(fakeServer());
  await hub.settled(10_000);
  hub.sync([]);

  expect(hub.status()).toEqual([]);
});

describe("a remote server that asks to sign in", () => {
  const servers: Awaited<ReturnType<typeof startOAuthMcpServer>>[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  const pages: string[] = [];

  const browser: McpSignInOptions = {
    open: (url) => void browse(url).then((page) => pages.push(page)),
    page: (result) => (result.ok ? "signed in" : `failed: ${result.message}`),
  };

  async function remote() {
    const server = await startOAuthMcpServer();
    const signIns = new Map<string, string>();
    const hub = setup({}, signIns);

    servers.push(server);
    hub.sync(
      parseMcpFile(
        JSON.stringify({ mcpServers: { remote: { url: server.url } } })
      )
    );
    await hub.settled(10_000);

    return { server, signIns, hub };
  }

  async function signedIn() {
    const setup = await remote();

    await setup.hub.signIn("remote", browser);
    await setup.hub.settled(10_000);

    const [whoami] = toolsOf(setup.hub, {
      policies: { "remote/whoami": McpToolPolicy.Auto },
      allow: async () => false,
    });

    const callWhoami = async (id: string) =>
      contentText((await call(whoami, {}, id)).content ?? []);

    const saved = () => JSON.parse(setup.signIns.get("remote") ?? "{}");

    return { ...setup, call: callWhoami, saved };
  }

  test("a connection the browser keeps open does not hold the sign-in", async () => {
    const { hub } = await remote();
    const spare: Socket[] = [];

    await hub.signIn("remote", {
      ...browser,
      open(url) {
        // Browsers connect ahead of need and may leave the connection unused.
        const redirect = new URL(
          new URL(url).searchParams.get("redirect_uri") ?? ""
        );

        spare.push(
          connect(Number(redirect.port), redirect.hostname, () =>
            browser.open(url)
          )
        );
      },
    });
    await hub.settled(10_000);

    expect(hub.status()).toMatchObject([
      { state: McpServerState.Connected, signedIn: true },
    ]);

    for (const socket of spare) socket.destroy();
  });

  test("waits for the user, then connects with the grant it saves", async () => {
    pages.length = 0;

    const { hub, call, saved } = await signedIn();

    expect(hub.status()).toMatchObject([
      {
        name: "remote",
        state: McpServerState.Connected,
        signedIn: true,
        tools: [{ name: "whoami", readOnly: true }],
      },
    ]);
    expect(await call("a")).toBe("token=access-1");
    await vi.waitFor(() => expect(pages).toEqual(["signed in"]));

    // Only what outlives the sign-in is kept.
    expect(Object.keys(saved()).sort()).toEqual([
      "clientInformation",
      "serverUrl",
      "tokens",
      "tokensExpireAt",
    ]);
  });

  test("starts out waiting for a sign-in", async () => {
    const { hub } = await remote();

    expect(hub.status()).toMatchObject([
      { state: McpServerState.NeedsSignIn, signedIn: false, tools: [] },
    ]);
  });

  test("an expired token is refreshed and the new grant saved", async () => {
    const { server, call, saved } = await signedIn();

    server.expireAccessTokens();

    expect(await call("a")).toBe("token=access-2");
    expect(saved().tokens).toMatchObject({
      access_token: "access-2",
      refresh_token: "refresh-2",
    });
  });

  test("a revoked grant asks again, and signing in again reuses the registration", async () => {
    const { server, hub, call } = await signedIn();

    server.revoke();

    await expect(call("a")).rejects.toThrow("user interaction");
    expect(hub.status()[0]?.state).toBe(McpServerState.NeedsSignIn);

    await hub.signIn("remote", browser);
    await hub.settled(10_000);

    expect(hub.status()[0]?.state).toBe(McpServerState.Connected);
    expect(server.registrations()).toBe(1);
  });

  test("signing out forgets the grant", async () => {
    const { hub, signIns } = await signedIn();

    await hub.signOut("remote");
    await hub.settled(10_000);

    expect(signIns.has("remote")).toBe(false);
    expect(hub.status()).toMatchObject([
      { state: McpServerState.NeedsSignIn, signedIn: false },
    ]);
  });

  test("a cancelled sign-in saves nothing", async () => {
    const { hub, signIns } = await remote();
    const controller = new AbortController();

    await expect(
      hub.signIn("remote", {
        open: () => controller.abort(),
        page: () => "",
        signal: controller.signal,
      })
    ).rejects.toThrow();
    expect(signIns.has("remote")).toBe(false);
  });

  test("only a remote server signs in", async () => {
    const hub = setup();

    hub.sync(fakeServer());

    await expect(hub.signIn("fake", browser)).rejects.toThrow(
      "not a remote server"
    );
  });
});
