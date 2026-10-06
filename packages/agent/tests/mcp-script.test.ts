import { fileURLToPath } from "node:url";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { afterEach, expect, test, vi } from "vite-plus/test";

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
  ToolCallStatus,
  foldEvents,
  runToolScriptDetailsSchema,
} from "../src/wire.ts";
import type { AgentWireEvent, ToolCallView } from "../src/wire.ts";

const SERVER = fileURLToPath(
  new URL("fixtures/mcp-server.mjs", import.meta.url)
);

const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

/** The agent on the fake server's tools under `policies`, running `code` as its one script. */
async function runScript(
  code: string,
  policies: Record<string, McpToolPolicy>
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
  const scripts = createScriptRunner();

  models.setProvider(faux.provider);

  const runtime = createAgentRuntime({
    store: Promise.resolve({
      storage: new MemoryStorage(),
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
        offered: [mcp.search, mcpScriptExtension(mcp.catalog, scripts)],
        deferred: [mcp.tools],
      };
    },
    onEvent: (_sessionId, event) => events.push(event),
  });

  closers.push(async () => {
    await runtime.close();
    await scripts.close();
    await hub.close();
  });

  faux.setResponses([
    fauxAssistantMessage(fauxToolCall(AgentToolName.RunToolScript, { code }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("Done."),
  ]);

  const { id } = await runtime.create();

  await runtime.send(id, { text: "Look it up", context: "" });

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

  const ended = async () => {
    await vi.waitFor(() =>
      expect(events.at(-1)).toMatchObject({ type: AgentEventType.RunEnd })
    );

    const [parent] = tools();

    return {
      output: runToolScriptDetailsSchema.parse(parent?.details).output,
      tools: tools(),
      replayed: foldEvents(await runtime.transcript(id)).items,
      live: foldEvents(events).items,
    };
  };

  return { id, runtime, events, waiting, ended };
}

test("a script finds tools and calls those that run unasked at once, each shown under it", async () => {
  const { events, ended } = await runScript(
    `
    const [found] = await searchTools("latest price");
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

  expect(output).toBe(
    'declared\nResult: ["{\\"symbol\\":\\"2330\\"}","{\\"symbol\\":\\"2317\\"}"]'
  );

  const [script] = tools;

  expect(tools).toMatchObject([
    { toolName: AgentToolName.RunToolScript, status: ToolCallStatus.Ok },
    {
      toolName: "mcp_fake_quote",
      parentToolCallId: script?.toolCallId,
      status: ToolCallStatus.Ok,
    },
    {
      toolName: "mcp_fake_quote",
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
  expect(output).toContain('Result: "quote {\\"symbol\\":\\"2330\\"}');
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
