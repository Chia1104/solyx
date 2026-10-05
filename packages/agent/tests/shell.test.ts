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
import type { ShellOptions } from "../src/shell.ts";
import {
  AgentEventType,
  AgentItemKind,
  AgentToolName,
  ApprovalMode,
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

/**
 * The agent on the shell alone, while `on` says the user has it switched on. `judge` stands in
 * for the decisions model, which no one has set up unless a test says so.
 */
function setup(
  on: () => boolean = () => true,
  judge: ShellOptions["judge"] = async () => undefined
) {
  const faux = fauxProvider();
  const models = createModels();
  const events: AgentWireEvent[] = [];
  const offered: string[][] = [];

  models.setProvider(faux.provider);

  const shell = createShell({
    workspace: (id) => join(directory, id),
    path: async () => process.env.PATH,
    judge,
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

  /** Starts a run whose reply runs `command`, in a conversation set to `mode`. */
  async function start(command: string, mode: ApprovalMode = ApprovalMode.Ask) {
    const { id } = await runtime.create();

    await runtime.setApprovalMode(id, mode);
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall(AgentToolName.Bash, { command }), {
        stopReason: "toolUse",
      }),
      done,
    ]);

    await runtime.send(id, { text: "Run it", context: "" });

    return id;
  }

  /** Starts such a run, resolving once its command waits for the user. */
  async function ask(command: string, mode?: ApprovalMode) {
    const id = await start(command, mode);

    await vi.waitFor(() =>
      expect(call()).toMatchObject({ status: ToolCallStatus.AwaitingApproval })
    );

    const waiting = call();

    if (waiting?.kind !== AgentItemKind.Tool) throw new Error("No call");

    return { id, toolCallId: waiting.toolCallId };
  }

  return { faux, runtime, events, offered, done, call, ended, start, ask };
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

posix(
  "in a conversation set to auto, a command the model judges harmless runs unasked, and the transcript says who allowed it",
  async () => {
    const judge = vi.fn(async () => ({ changes: 0.04, network: 0.02 }));
    const { runtime, events, call, ended, start } = setup(() => true, judge);
    const id = await start("printf ok", ApprovalMode.Auto);

    await ended();

    expect(judge).toHaveBeenCalledWith(
      { command: "printf ok", shell: "bash" },
      expect.anything()
    );
    expect(call()).toMatchObject({
      status: ToolCallStatus.Ok,
      output: "ok",
      autoApproved: true,
    });
    expect(
      events.some((event) => event.type === AgentEventType.ApprovalRequest)
    ).toBe(false);

    // Read back, as a window opened later would, the call still shows as the model's.
    expect(
      foldEvents(await runtime.transcript(id)).items.find(
        (item) => item.kind === AgentItemKind.Tool
      )
    ).toMatchObject({ autoApproved: true });

    await runtime.close();
  }
);

posix.each([
  ["one risk is likely", async () => ({ changes: 0.04, network: 0.9 })],
  ["no decisions model is set up", async () => undefined],
  [
    "the judgement fails",
    async () => {
      throw new Error("The decisions API is down");
    },
  ],
] satisfies [string, ShellOptions["judge"]][])(
  "in a conversation set to auto, a command still asks when %s",
  async (_case, judge) => {
    const { runtime, call, ended, ask } = setup(() => true, judge);
    const { id, toolCallId } = await ask("printf ok", ApprovalMode.Auto);

    runtime.approve(id, toolCallId, true);
    await ended();

    expect(call()).toMatchObject({ status: ToolCallStatus.Ok });
    expect(call()).not.toMatchObject({ autoApproved: true });

    await runtime.close();
  }
);

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
