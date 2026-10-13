import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  getCurrentTools,
} from "@earendil-works/pi-ai";
import type {
  AssistantMessage,
  FauxResponseFactory,
} from "@earendil-works/pi-ai";
import { MemoryStorage, defineExtension } from "@earendil-works/pi-durable";
import type { Storage } from "@earendil-works/pi-durable";
import { CODEMODE_TOOL_NAME } from "@earendil-works/pi-durable/codemode";
import type {
  CodemodeNestedCall,
  CodemodeToolDetails,
} from "@earendil-works/pi-durable/codemode";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { TOOL_SEARCH_TOOL_NAME } from "@earendil-works/pi-durable/tool-search";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { McpToolPolicy, parseMcpFile } from "../src/mcp-config.ts";
import { mcpScriptExtension } from "../src/mcp-script.ts";
import { createMcpHub } from "../src/mcp.ts";
import { AgentThinking } from "../src/providers.ts";
import { createAgentRuntime } from "../src/runtime.ts";
import { createScriptRunner } from "../src/script-runner.ts";
import {
  AgentEventType,
  AgentItemKind,
  AgentToolName,
  ScriptCallStatus,
  ToolCallStatus,
  codemodeDetailsSchema,
  foldEvents,
} from "../src/wire.ts";
import type { AgentWireEvent, ToolCallView } from "../src/wire.ts";

const SERVER = fileURLToPath(
  new URL("fixtures/mcp-server.mjs", import.meta.url)
);

const closers: (() => Promise<void>)[] = [];

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-mcp-script-"));
});

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  await rm(directory, { recursive: true, force: true });
});

/**
 * The agent on the fake server's tools under `policies`, beside one tool of the app's own, giving
 * `replies` in turn; `start` sends the message they answer. `offered` notes the tools each request
 * offered.
 */
async function setup(
  policies: Record<string, McpToolPolicy>,
  replies: AssistantMessage[],
  storage: Storage = new MemoryStorage()
) {
  const hub = createMcpHub({
    client: { name: "solyx-test", version: "0.0.0" },
    secret: async () => undefined,
    path: async () => undefined,
    signIns: { read: async () => undefined, write: async () => undefined },
  });

  hub.sync(
    parseMcpFile(
      JSON.stringify({
        mcpServers: { fake: { command: process.execPath, args: [SERVER] } },
      })
    )
  );
  await hub.settled(10_000);

  const faux = fauxProvider();
  const models = createModels();
  const events: AgentWireEvent[] = [];
  const offered: string[][] = [];
  const scripts = createScriptRunner();

  models.setProvider(faux.provider);

  const runtime = createAgentRuntime({
    store: Promise.resolve({
      storage,
      deleteConversation: vi.fn(async () => undefined),
    }),
    models,
    model: async () => ({
      model: faux.getModel(),
      thinking: AgentThinking.Off,
    }),
    async tools(guard) {
      const mcp = hub.extensions({ policies, guard });

      return {
        offered: [
          defineExtension({
            name: "own",
            tools: [
              {
                name: AgentToolName.GetWatchlist,
                description: "The watchlist",
                parameters: { type: "object", properties: {} },
                replay: "safe",
                execute: async () => ({
                  output: [{ type: "text", text: "TW 2330" }],
                }),
              },
            ],
          }),
          mcp.search,
          mcpScriptExtension(mcp, scripts),
        ],
        deferred: [mcp.tools],
      };
    },
    onEvent: (_sessionId, event) => events.push(event),
  });

  let closed = false;

  /** Closes the agent as the app quitting would. */
  async function close() {
    if (closed) return;

    closed = true;
    await runtime.close();
    await scripts.close();
    await hub.close();
  }

  closers.push(close);

  faux.setResponses(
    replies.map((reply): FauxResponseFactory => (context) => {
      offered.push(getCurrentTools(context.messages).map((tool) => tool.name));

      return reply;
    })
  );

  async function start() {
    const { id } = await runtime.create();

    await runtime.send(id, { text: "Look it up", context: "" });

    return id;
  }

  const tools = () =>
    foldEvents(events).items.filter(
      (item): item is ToolCallView => item.kind === AgentItemKind.Tool
    );

  /** The id of the script's call of `toolName` once it waits for the user. */
  async function waiting(toolName: string) {
    await vi.waitFor(() =>
      expect(tools()).toContainEqual(
        expect.objectContaining({
          toolName,
          status: ToolCallStatus.AwaitingApproval,
        })
      )
    );

    const call = tools().find((tool) => tool.toolName === toolName);

    if (!call) throw new Error(`No call of ${toolName}`);

    return call.toolCallId;
  }

  const ended = async (id: string) => {
    await vi.waitFor(() =>
      expect(events.at(-1)).toMatchObject({ type: AgentEventType.RunEnd })
    );

    return {
      output: tools()[0]?.output,
      tools: tools(),
      replayed: foldEvents(await runtime.transcript(id)).items,
      live: foldEvents(events).items,
    };
  };

  return { runtime, events, offered, start, waiting, ended, close };
}

const calling = (toolName: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(toolName, args), { stopReason: "toolUse" });

/** The agent running `code` as its one script, in the conversation `id`. */
async function runScript(
  code: string,
  policies: Record<string, McpToolPolicy>
) {
  const agent = await setup(policies, [
    calling(AgentToolName.Codemode, { code }),
    fauxAssistantMessage("Done."),
  ]);

  const id = await agent.start();

  return { ...agent, id, ended: () => agent.ended(id) };
}

const ORDER_OR_WHY_NOT = `
  try {
    return await tools.mcp_fake_order({});
  } catch (error) {
    return "not placed: " + error.message;
  }
`;

test("the wire names the tools and reads a script's details as pi-durable writes them", () => {
  expect(AgentToolName.Codemode).toBe(CODEMODE_TOOL_NAME);
  expect(AgentToolName.ToolSearch).toBe(TOOL_SEARCH_TOOL_NAME);

  // Fails to compile once pi-durable tells of an ending the wire does not know.
  const statuses: Record<CodemodeNestedCall["status"], ScriptCallStatus> = {
    running: ScriptCallStatus.Running,
    ok: ScriptCallStatus.Ok,
    error: ScriptCallStatus.Error,
    cancelled: ScriptCallStatus.Cancelled,
  };

  const details: CodemodeToolDetails = {
    calls: [
      { id: 1, name: "quote", args: '{"symbol":"2330"}', status: "ok" },
      // Arguments too long to keep whole are cut, and no longer parse.
      { id: 2, name: "quote", args: '{"symbol":"23...', status: "cancelled" },
    ],
  };

  expect(Object.keys(statuses)).toEqual(Object.values(ScriptCallStatus));
  expect(codemodeDetailsSchema.parse(details).calls).toEqual([
    { id: 1, name: "quote", args: { symbol: "2330" }, status: "ok" },
    { id: 2, name: "quote", args: '{"symbol":"23...', status: "cancelled" },
  ]);
});

test("a script finds tools and calls those that run unasked at once, each shown under it", async () => {
  const { events, ended } = await runScript(
    `
    const [found] = await searchTools("latest price", { namespace: "fake" });
    const declared = await describeTool(found.name);
    const quotes = await Promise.all(
      ["2330", "2317"].map((symbol) => tools[found.name]({ symbol }))
    );
    text(declared.includes("symbol: string") ? "declared" : declared);
    return quotes.map((quote) => quote.split(" ")[1]);
    `,
    { "fake/quote": McpToolPolicy.Auto }
  );

  const { output, tools, replayed, live } = await ended();

  expect(output).toContain("Script completed");
  expect(output).toContain("declared");
  expect(output).toContain(
    '["{\\"symbol\\":\\"2330\\"}","{\\"symbol\\":\\"2317\\"}"]'
  );

  const [script] = tools;

  expect(tools).toMatchObject([
    { toolName: AgentToolName.Codemode, status: ToolCallStatus.Ok },
    {
      toolName: "mcp_fake_quote",
      args: { symbol: "2330" },
      parentToolCallId: script?.toolCallId,
      status: ToolCallStatus.Ok,
    },
    {
      toolName: "mcp_fake_quote",
      args: { symbol: "2317" },
      parentToolCallId: script?.toolCallId,
      status: ToolCallStatus.Ok,
    },
  ]);
  expect(
    events.some((event) => event.type === AgentEventType.ApprovalRequest)
  ).toBe(false);
  expect(replayed).toEqual(live);
});

test("each call the user's settings ask about waits for them under the script, and a refused one throws there", async () => {
  const { id, runtime, waiting, ended } = await runScript(
    `
    try {
      await tools.mcp_fake_order({});
    } catch (error) {
      text("refused: " + error.message);
    }
    return await tools.mcp_fake_quote({ symbol: "2330" });
    `,
    {}
  );

  runtime.approve(id, await waiting("mcp_fake_order"), false);
  runtime.approve(id, await waiting("mcp_fake_quote"), true);

  const { output, tools, replayed, live } = await ended();

  expect(output).toContain("refused: The user did not allow this call");
  expect(output).toContain('quote {"symbol":"2330"}');
  expect(tools.slice(1)).toMatchObject([
    {
      toolName: "mcp_fake_order",
      status: ToolCallStatus.Error,
      error: "The user did not allow this call",
    },
    { toolName: "mcp_fake_quote", status: ToolCallStatus.Ok },
  ]);
  // A transcript read from storage shows each call and what the user answered.
  expect(replayed).toEqual(live);
});

test("a script reaches the servers' tools and none of the app's own", async () => {
  const { ended } = await runScript(
    `return { all: ALL_TOOLS.map((tool) => tool.name), own: "get_watchlist" in tools };`,
    {}
  );

  const { output } = await ended();

  expect(output).toContain(
    '{"all":["mcp_fake_quote","mcp_fake_order"],"own":false}'
  );
});

test("a search loads the tools it finds for the next request, which may then call them", async () => {
  const { offered, start, ended } = await setup(
    { "fake/quote": McpToolPolicy.Auto },
    [
      calling(AgentToolName.ToolSearch, { query: "latest price" }),
      calling("mcp_fake_quote", { symbol: "2330" }),
      fauxAssistantMessage("Done."),
    ]
  );

  const { tools } = await ended(await start());
  const always = ["get_watchlist", "tool_search", "codemode"];

  expect(offered).toEqual([
    always,
    [...always, "mcp_fake_quote"],
    [...always, "mcp_fake_quote"],
  ]);
  expect(tools).toMatchObject([
    { toolName: AgentToolName.ToolSearch, status: ToolCallStatus.Ok },
    { toolName: "mcp_fake_quote", status: ToolCallStatus.Ok },
  ]);
});

test("stopping the run withdraws the question of a script's call, which is never sent", async () => {
  const { id, runtime, waiting, ended } = await runScript(ORDER_OR_WHY_NOT, {});
  const toolCallId = await waiting("mcp_fake_order");

  await runtime.abort(id);

  const { tools } = await ended();

  expect(tools).toMatchObject([
    { toolName: AgentToolName.Codemode, status: ToolCallStatus.Aborted },
    { toolName: "mcp_fake_order", status: ToolCallStatus.Aborted },
  ]);
  expect(() => runtime.approve(id, toolCallId, true)).toThrow(
    "no longer waiting"
  );
});

test("a script's call left waiting when the app quit is not sent once the script carries on", async () => {
  const path = join(directory, "agent.sqlite");

  const quitting = await setup(
    {},
    [calling(AgentToolName.Codemode, { code: ORDER_OR_WHY_NOT })],
    await openNodeSqliteStorage(path)
  );

  const id = await quitting.start();

  await quitting.waiting("mcp_fake_order");
  await quitting.close();

  const restarted = await setup(
    {},
    [fauxAssistantMessage("Done.")],
    await openNodeSqliteStorage(path)
  );

  await restarted.runtime.resume();

  const { replayed } = await restarted.ended(id);

  const [script] = replayed.filter(
    (item): item is ToolCallView => item.kind === AgentItemKind.Tool
  );

  // The script went on, told that its call did not run, and waits for nobody.
  expect(script?.output).toContain("not placed: ");
  expect(script?.output).not.toContain("order {}");
  expect(replayed).toContainEqual(
    expect.objectContaining({
      toolName: "mcp_fake_order",
      status: ToolCallStatus.Error,
    })
  );
});
