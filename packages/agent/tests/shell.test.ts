import {
  access,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { FauxResponseFactory } from "@earendil-works/pi-ai";
import {
  getCurrentSystemPrompt,
  getCurrentTools,
} from "@earendil-works/pi-ai/utils/transcript";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { AgentThinking } from "../src/providers.ts";
import { createAgentRuntime } from "../src/runtime.ts";
import { SANDBOX_SUPPORTED, sandboxProblems } from "../src/sandbox.ts";
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

// The sandbox runs where the system has one and what it needs is there, as CI may not have it.
const sandboxed = test.runIf(
  SANDBOX_SUPPORTED && (await sandboxProblems()).length === 0
);

const supported = test.runIf(SANDBOX_SUPPORTED);

let directory: string;

/**
 * Stands in for the user's home, the app's settings, a skill offered inside them and a shared
 * skill that is a link to the whole home.
 */
const placesIn = (directory: string) => ({
  home: join(directory, "home"),
  app: join(directory, "home", ".solyx"),
  skill: join(directory, "home", ".solyx", "skills", "notes"),
  link: join(directory, "home", ".agents", "skills", "everything"),
});

let places: ReturnType<typeof placesIn>;

const closers: (() => Promise<void>)[] = [];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-shell-"));
  places = placesIn(directory);
  await mkdir(places.skill, { recursive: true });
  await writeFile(join(places.home, "diary.txt"), "diary-secret");
  await writeFile(join(places.app, "config.json"), "config-secret");
  await writeFile(join(places.skill, "SKILL.md"), "skill-body");
  await mkdir(join(places.link, ".."), { recursive: true });
  await symlink(places.home, places.link);
  vi.stubEnv("SOLYX_TEST_KEY", "leaked");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(closers.splice(0).map((close) => close()));
  await rm(directory, { recursive: true, force: true });
});

/**
 * The agent on the shell alone, while `on` says the user has it switched on and `sandbox` that
 * they keep its sandbox on, which the tests not about the sandbox leave off. `judge` stands in for
 * the decisions model, which no one has set up unless a test says so.
 */
function setup({
  on = () => true,
  sandbox = () => false,
  judge = async () => undefined,
  path = async () => process.env.PATH,
}: {
  on?: () => boolean;
  sandbox?: () => boolean;
  judge?: ShellOptions["judge"];
  path?: ShellOptions["path"];
} = {}) {
  const faux = fauxProvider();
  const models = createModels();
  const events: AgentWireEvent[] = [];
  const offered: string[][] = [];
  const prompts: string[] = [];

  models.setProvider(faux.provider);

  const shell = createShell({
    workspace: (id) => join(directory, id),
    path,
    judge,
    sandbox: {
      home: places.home,
      appFolders: [places.app],
      enabled: sandbox,
      readable: async () => [places.skill, places.link],
    },
  });

  closers.push(shell.close);

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
    tools: async ({ guard }) => ({
      offered: on() ? [shell.extension(guard)] : [],
      deferred: [],
    }),
    env: shell.env,
    onEvent: (_sessionId, event) => events.push(event),
  });

  // Answers "Done.", noting which tools the request offered.
  const done: FauxResponseFactory = (context) => {
    offered.push(getCurrentTools(context.messages).map((tool) => tool.name));
    prompts.push(getCurrentSystemPrompt(context.messages));

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

  return {
    faux,
    runtime,
    events,
    offered,
    prompts,
    done,
    call,
    ended,
    start,
    ask,
  };
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
    const { runtime, events, call, ended, start } = setup({ judge });
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
    const { runtime, call, ended, ask } = setup({ judge });
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
  const { faux, runtime, offered, done, ended } = setup({ on: () => on });
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

sandboxed(
  "a sandboxed command reads the skills offered but nothing else of the home or the app's folders, and writes only in its own",
  async () => {
    const { runtime, call, ended, start } = setup({ sandbox: () => true });

    const id = await start(
      [
        `cat ${places.skill}/SKILL.md`,
        `cat ${places.home}/diary.txt`,
        `cat ${places.link}/diary.txt`,
        `cat ${places.app}/config.json`,
        `touch ${places.home}/made`,
        "touch made",
      ].join("; "),
      ApprovalMode.Bypass
    );

    await ended();

    const ran = call();
    const output = ran?.kind === AgentItemKind.Tool ? (ran.output ?? "") : "";

    expect(output).toMatch(/^skill-body/);
    expect(output).not.toMatch(/secret/);
    expect(output.match(/Operation not permitted/g)).toHaveLength(4);
    expect(await exists(join(places.home, "made"))).toBe(false);
    expect(await exists(join(directory, id, "made"))).toBe(true);

    await runtime.close();
  }
);

sandboxed(
  "a sandboxed command reaches no network, this computer included",
  async () => {
    const server = createServer((_request, response) => response.end("served"));

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );

    // SAFETY: a server listening on a TCP port has an address with a port.
    const { port } = server.address() as AddressInfo;
    const { runtime, call, ended, start } = setup({ sandbox: () => true });

    await start(
      [
        `curl -sS -m 5 http://127.0.0.1:${port}/`,
        `curl -sS -m 5 --noproxy '*' http://127.0.0.1:${port}/`,
      ].join("; "),
      ApprovalMode.Bypass
    );
    await ended();

    const ran = call();

    expect(ran?.kind === AgentItemKind.Tool && ran.output).not.toMatch(
      /served/
    );

    server.close();
    await runtime.close();
  }
);

sandboxed(
  "a sandboxed command keeps its settings and temporary files in its own folder",
  async () => {
    const { runtime, call, ended, start } = setup({ sandbox: () => true });

    const id = await start(
      `printf '%s|%s|' "$HOME" "$TMPDIR"; mktemp "$TMPDIR/test.XXXXXX"`,
      ApprovalMode.Bypass
    );

    await ended();

    const ran = call();
    const folder = join(directory, id);

    expect(ran).toMatchObject({ status: ToolCallStatus.Ok });
    expect(ran?.kind === AgentItemKind.Tool && ran.output).toMatch(
      new RegExp(`^${folder}\\|${folder}/\\.tmp\\|${folder}/\\.tmp/test\\.`)
    );

    await runtime.close();
  }
);

sandboxed(
  "a sandboxed command runs the tools on its PATH under the home with what they link to, but no link opens the app's folders",
  async () => {
    const bin = join(places.home, ".local", "bin");
    const tool = join(places.home, ".tools", "greet");

    await mkdir(join(tool, "bin"), { recursive: true });
    await mkdir(join(tool, "share"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await writeFile(join(tool, "share", "greeting"), "hello");
    await writeFile(
      join(tool, "bin", "greet"),
      `#!/bin/sh\ncat "$(dirname "$(realpath "$0")")/../share/greeting"\n`,
      { mode: 0o755 }
    );
    await symlink(join(tool, "bin", "greet"), join(bin, "greet"));
    await symlink(join(places.app, "config.json"), join(bin, "config"));

    const { runtime, call, ended, start } = setup({
      sandbox: () => true,
      path: async () => `${bin}:${process.env.PATH}`,
    });

    await start(`greet; cat ${bin}/config`, ApprovalMode.Bypass);
    await ended();

    const ran = call();
    const output = ran?.kind === AgentItemKind.Tool ? (ran.output ?? "") : "";

    expect(output).toMatch(/^hello/);
    expect(output).not.toMatch(/secret/);
    expect(output).toMatch(/Operation not permitted/);

    await runtime.close();
  }
);

sandboxed(
  "a sandboxed command can neither make nor write the temporary folder every sandbox-runtime embedder shares",
  async () => {
    const { runtime, call, ended, start } = setup({ sandbox: () => true });

    await start(
      "mkdir -p /tmp/claude && touch /tmp/claude/solyx-shell-test",
      ApprovalMode.Bypass
    );
    await ended();

    expect(call()).toMatchObject({ status: ToolCallStatus.Error });
    expect(await exists("/tmp/claude/solyx-shell-test")).toBe(false);

    await runtime.close();
  }
);

supported(
  "with the sandbox switched off, a command runs with the user's access",
  async () => {
    const { runtime, call, ended, start } = setup();

    await start(`cat ${places.home}/diary.txt`, ApprovalMode.Bypass);
    await ended();

    expect(call()).toMatchObject({
      status: ToolCallStatus.Ok,
      output: "diary-secret",
    });

    await runtime.close();
  }
);

supported("the prompt tells how commands run as the switch is", async () => {
  let sandbox = true;

  const { faux, runtime, prompts, done, ended } = setup({
    sandbox: () => sandbox,
  });

  const { id } = await runtime.create();

  faux.setResponses([done, done]);

  await runtime.send(id, { text: "Hello", context: "" });
  await ended(1);

  sandbox = false;

  await runtime.send(id, { text: "Again", context: "" });
  await ended(2);

  expect(prompts[0]).toMatch(/in a sandbox/);
  expect(prompts[1]).toMatch(/with their access to its files and the network/);

  await runtime.close();
});
