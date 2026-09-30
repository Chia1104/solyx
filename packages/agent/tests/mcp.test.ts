import { fileURLToPath } from "node:url";

import { contentText } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import {
  McpServerState,
  McpToolPolicy,
  McpTransportKind,
  parseMcpFile,
} from "../src/mcp-config.ts";
import { createMcpHub, effectivePolicy } from "../src/mcp.ts";
import type { McpHub } from "../src/mcp.ts";

const SERVER = fileURLToPath(
  new URL("fixtures/mcp-server.mjs", import.meta.url)
);

const hubs: McpHub[] = [];

afterEach(async () => {
  await Promise.all(hubs.splice(0).map((hub) => hub.close()));
});

function setup(secrets: Record<string, string> = { fake: "s3cret" }) {
  const hub = createMcpHub({
    client: { name: "solyx-test", version: "0.0.0" },
    secret: async (name) => secrets[name],
    path: async () => undefined,
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
    const tools = hub.tools({ policies: {}, allow });
    const quote = tools.find((tool) => tool.name === "mcp_fake_quote");
    const result = await quote?.execute("call-1", { symbol: "2330" });

    expect(allow).toHaveBeenCalledWith(
      {
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

    const [order] = hub
      .tools({ policies: {}, allow: async () => false })
      .filter((tool) => tool.name === "mcp_fake_order");

    await expect(order.execute("call-1", {})).rejects.toThrow("did not allow");
  });

  test("policies decide what is offered and what still asks", async () => {
    const hub = setup();

    hub.sync(fakeServer());
    await hub.settled(10_000);

    const allow = vi.fn(async () => true);

    const tools = hub.tools({
      policies: {
        "fake/quote": McpToolPolicy.Auto,
        "fake/order": McpToolPolicy.Auto,
      },
      allow,
    });

    await tools
      .find((tool) => tool.name === "mcp_fake_quote")
      ?.execute("a", { symbol: "X" });
    expect(allow).not.toHaveBeenCalled();

    // Marked auto, but not read-only, so it still asks.
    await tools
      .find((tool) => tool.name === "mcp_fake_order")
      ?.execute("b", {});
    expect(allow).toHaveBeenCalledOnce();

    expect(
      hub
        .tools({ policies: { "fake/order": McpToolPolicy.Off }, allow })
        .map((tool) => tool.name)
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
  expect(hub.tools({ policies: {}, allow: async () => true })).toEqual([]);
});

test("a server taken out of mcp.json is disconnected", async () => {
  const hub = setup();

  hub.sync(fakeServer());
  await hub.settled(10_000);
  hub.sync([]);

  expect(hub.status()).toEqual([]);
});
