import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { FauxResponseFactory } from "@earendil-works/pi-ai";
import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { AgentThinking } from "../src/providers.ts";
import { createAgentRuntime } from "../src/runtime.ts";
import { createShell } from "../src/shell.ts";
import {
  AgentEventType,
  AgentItemKind,
  AgentToolName,
  ToolCallStatus,
  foldEvents,
} from "../src/wire.ts";
import type { AgentWireEvent } from "../src/wire.ts";

// The commands below are bash; Windows runs PowerShell.
const posix = test.skipIf(process.platform === "win32");

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-shell-"));
  vi.stubEnv("SOLYX_TEST_KEY", "leaked");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

/** The agent on the shell alone, while `on` says the user has it switched on. */
function setup(on: () => boolean = () => true) {
  const faux = fauxProvider();
  const models = createModels();
  const events: AgentWireEvent[] = [];
  const offered: string[][] = [];

  models.setProvider(faux.provider);

  const shell = createShell({
    workspace: (id) => join(directory, id),
    path: async () => process.env.PATH,
  });

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
    tools: async (guard) => ({
      offered: on() ? [shell.extension(guard)] : [],
      deferred: [],
    }),
    env: shell.env,
    onEvent: (_sessionId, event) => events.push(event),
  });

  // Answers "Done.", noting which tools the request offered.
  const done: FauxResponseFactory = (context) => {
    offered.push(getCurrentTools(context.messages).map((tool) => tool.name));

    return fauxAssistantMessage("Done.");
  };

  const call = () =>
    foldEvents(events).items.find((item) => item.kind === AgentItemKind.Tool);

  const ended = (count = 1) =>
    vi.waitFor(() =>
      expect(
        events.filter((event) => event.type === AgentEventType.RunEnd)
      ).toHaveLength(count)
    );

  /** Starts a run whose reply runs `command`, resolving once it waits for the user. */
  async function ask(command: string) {
    const { id } = await runtime.create();

    faux.setResponses([
      fauxAssistantMessage(fauxToolCall(AgentToolName.Bash, { command }), {
        stopReason: "toolUse",
      }),
      done,
    ]);

    await runtime.send(id, { text: "Run it", context: "" });
    await vi.waitFor(() =>
      expect(call()).toMatchObject({ status: ToolCallStatus.AwaitingApproval })
    );

    const waiting = call();

    if (waiting?.kind !== AgentItemKind.Tool) throw new Error("No call");

    return { id, toolCallId: waiting.toolCallId };
  }

  return { faux, runtime, offered, done, call, ended, ask };
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false
  );

posix(
  "a command waits for the user, then runs in its conversation's folder without the app's environment",
  async () => {
    const { runtime, call, ended, ask } = setup();

    const { id, toolCallId } = await ask(
      `printf '%s|%s|' "$PWD" "$SOLYX_TEST_KEY"; touch made`
    );

    // Nothing of the command has happened while it waits.
    expect(await exists(join(directory, id))).toBe(false);

    runtime.approve(id, toolCallId, true);
    await ended();

    const ran = call();

    expect(ran).toMatchObject({ status: ToolCallStatus.Ok });
    expect(ran?.kind === AgentItemKind.Tool && ran.output).toMatch(
      new RegExp(`/${id}\\|\\|$`)
    );
    expect(await exists(join(directory, id, "made"))).toBe(true);

    await runtime.close();
  }
);

posix("a command the user refuses never runs", async () => {
  const { runtime, call, ended, ask } = setup();
  const { id, toolCallId } = await ask("touch made");

  runtime.approve(id, toolCallId, false);
  await ended();

  expect(call()).toMatchObject({ status: ToolCallStatus.Error });
  expect(await exists(join(directory, id, "made"))).toBe(false);

  await runtime.close();
});

test("the shell is offered only while it is switched on", async () => {
  let on = true;
  const { faux, runtime, offered, done, ended } = setup(() => on);
  const { id } = await runtime.create();

  faux.setResponses([done, done]);

  await runtime.send(id, { text: "Hello", context: "" });
  await ended(1);

  on = false;

  await runtime.send(id, { text: "Again", context: "" });
  await ended(2);

  expect(offered).toEqual([[AgentToolName.Bash], []]);

  await runtime.close();
});
