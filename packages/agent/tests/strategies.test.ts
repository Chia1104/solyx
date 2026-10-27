import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { FauxResponseFactory } from "@earendil-works/pi-ai";
import { getCurrentSystemPrompt } from "@earendil-works/pi-ai/utils/transcript";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { StrategyApprover } from "@solyx/core/strategy";
import type {
  StrategyApproval,
  StrategyReach,
  StrategyRuntime,
} from "@solyx/core/strategy";

import { AgentThinking } from "../src/providers.ts";
import { createAgentRuntime } from "../src/runtime.ts";
import { createStrategyTools } from "../src/strategies.ts";
import type { StrategiesPort, StrategyView } from "../src/strategies.ts";
import {
  AgentEventType,
  AgentItemKind,
  AgentToolName,
  ApprovalMode,
  ToolCallStatus,
  foldEvents,
} from "../src/wire.ts";
import type { AgentWireEvent } from "../src/wire.ts";

const VERSION = "a1b2c3d4e5f6a7b8c9d0";

const CROSSING: StrategyView = {
  name: "crossing",
  description: "Holds while the close stands above its own average.",
  run: "python3 strategy.py",
  params: { period: { min: 2, max: 30, step: 1, initial: 10 } },
  rules: {
    entry: { crossesAbove: [{ line: "close" }, { line: "mean" }] },
    exit: { crossesBelow: [{ line: "close" }, { line: "mean" }] },
  },
  notes: "Reads the close against its mean.",
  version: VERSION,
  files: [
    { path: "STRATEGY.md", bytes: 10, text: "---\n---" },
    { path: "strategy.py", bytes: 12, text: "print('lines')" },
  ],
  allowed: null,
};

const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

/**
 * The agent on the strategy tools alone, over one strategy whose code would run where `reach`
 * says, and a decisions model that sees `risk` in its code, or none set up.
 */
function setup({
  reach = { sandboxed: true, live: false },
  risk,
  strategy = CROSSING,
  listed = true,
}: {
  reach?: StrategyReach;
  risk?: number;
  strategy?: StrategyView;
  listed?: boolean;
} = {}) {
  const faux = fauxProvider();
  const models = createModels();
  const events: AgentWireEvent[] = [];
  const prompts: string[] = [];
  const results: string[] = [];

  // Each strategy's version as its files are now, which a save moves on.
  const versions = new Map(listed ? [[strategy.name, strategy.version]] : []);

  models.setProvider(faux.provider);

  const approve = vi.fn<StrategiesPort["approve"]>(
    async (name, version, by): Promise<StrategyApproval> => ({
      name,
      version,
      by,
      outside: !reach.sandboxed,
      at: 0,
    })
  );

  const judge = vi.fn<StrategiesPort["judge"]>(async () =>
    risk === undefined
      ? undefined
      : { files: risk, network: 0.01, secrets: 0.01, runs: 0.01 }
  );

  const draft = vi.fn<StrategiesPort["draft"]>(
    async (name, basedOn, change) => {
      const now = versions.get(name) ?? null;
      const version = drafted(name, change, now);

      if (now === null && basedOn !== undefined) {
        throw new Error(`No strategy is named ${name}`);
      }

      if (now !== null && version !== now && basedOn !== now) {
        throw new Error(`${name}'s files changed since that version`);
      }

      return {
        current: now,
        draft: {
          name,
          run: "python3 strategy.py",
          version,
          files: change.files.map(({ path, text }) => ({
            path,
            bytes: text.length,
            text,
          })),
        },
      };
    }
  );

  const save = vi.fn<StrategiesPort["save"]>(async (name, basedOn, change) => {
    const { draft: made } = await draft(name, basedOn, change);

    versions.set(name, made.version);

    return made.version;
  });

  const port: StrategiesPort = {
    catalog: async () => ({
      strategies: listed ? [strategy] : [],
      reach,
      problems: [],
    }),
    lines: vi.fn(),
    approve,
    judge,
    draft,
    save,
    runtimes: async (): Promise<StrategyRuntime[]> => [
      {
        command: "python3",
        version: "Python 3.12.1",
        packages: { numpy: "2.1.0" },
      },
      { command: "node", version: "v22.0.0", packages: {} },
    ],
  };

  const tools = createStrategyTools(port);

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
      offered: [tools.extension(guard, listed)],
      deferred: [],
    }),
    onEvent: (_sessionId, event) => events.push(event),
  });

  closers.push(() => runtime.close());

  const done: FauxResponseFactory = (context) => {
    prompts.push(getCurrentSystemPrompt(context.messages));
    results.splice(
      0,
      results.length,
      ...context.messages.flatMap((message) =>
        message.role === "toolResult"
          ? [
              message.content
                .map((part) => (part.type === "text" ? part.text : ""))
                .join(""),
            ]
          : []
      )
    );

    return fauxAssistantMessage("Done.");
  };

  const calls = () =>
    foldEvents(events).items.filter((item) => item.kind === AgentItemKind.Tool);

  const call = () => calls().at(0);

  const ended = () =>
    vi.waitFor(() =>
      expect(
        events.filter((event) => event.type === AgentEventType.RunEnd)
      ).toHaveLength(1)
    );

  /** Starts a run whose reply allows `version` of the strategy, in a conversation set to `mode`. */
  async function allow(
    mode: ApprovalMode = ApprovalMode.Ask,
    version = VERSION
  ) {
    const { id } = await runtime.create();

    await runtime.setApprovalMode(id, mode);
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(AgentToolName.AllowStrategy, {
          name: "crossing",
          version,
        }),
        { stopReason: "toolUse" }
      ),
      done,
    ]);

    await runtime.send(id, { text: "Allow it", context: "" });

    return id;
  }

  /** Starts a run whose reply makes `calls` of `tool` one after another, in a conversation set to `mode`. */
  async function run(
    mode: ApprovalMode,
    tool: AgentToolName,
    ...args: Parameters<typeof fauxToolCall>[1][]
  ) {
    const { id } = await runtime.create();

    await runtime.setApprovalMode(id, mode);
    faux.setResponses([
      ...args.map((each) =>
        fauxAssistantMessage(fauxToolCall(tool, each), {
          stopReason: "toolUse",
        })
      ),
      done,
    ]);

    await runtime.send(id, { text: "Write it", context: "" });

    return id;
  }

  return {
    runtime,
    call,
    calls,
    ended,
    allow,
    run,
    approve,
    judge,
    draft,
    save,
    prompts,
    results,
    tools,
  };
}

/** The version the fake folder takes once `change` is made: the one it was where it changes nothing. */
const drafted = (
  name: string,
  change: { files: { text: string }[]; remove: string[] },
  now: string | null
) =>
  change.files.length === 0 && change.remove.length === 0 && now !== null
    ? now
    : `${name}@${change.files.map((file) => file.text).join("+")}`;

const NEW_FILES = [
  { path: "STRATEGY.md", text: "---\nname: breakout\n---" },
  { path: "strategy.py", text: "print('lines')" },
];

test("a version waits for the user, and is kept as theirs once they allow it", async () => {
  const { runtime, call, ended, allow, approve, prompts } = setup();
  const id = await allow();

  await vi.waitFor(() =>
    expect(call()).toMatchObject({ status: ToolCallStatus.AwaitingApproval })
  );

  const waiting = call();

  if (waiting?.kind !== AgentItemKind.Tool) throw new Error("No call");

  expect(approve).not.toHaveBeenCalled();

  runtime.approve(id, waiting.toolCallId, true);
  await ended();

  expect(approve).toHaveBeenCalledWith(
    "crossing",
    VERSION,
    StrategyApprover.User
  );
  expect(prompts[0]).toContain(
    "- crossing: Holds while the close stands above its own average. Numbers: period 2–30 by 1, from 10. Not allowed yet."
  );
});

test("in auto, a version whose code the decisions model finds harmless is allowed unasked, as the model's", async () => {
  const { ended, allow, approve, judge } = setup({ risk: 0.1 });

  await allow(ApprovalMode.Auto);
  await ended();

  expect(judge).toHaveBeenCalledOnce();
  expect(approve).toHaveBeenCalledWith(
    "crossing",
    VERSION,
    StrategyApprover.Check
  );
});

test("in auto, code the model finds risky, or no model at all, waits for the user", async () => {
  for (const risk of [0.4, undefined]) {
    const { call, allow, approve } = setup({ risk });

    await allow(ApprovalMode.Auto);
    await vi.waitFor(() =>
      expect(call()).toMatchObject({
        status: ToolCallStatus.AwaitingApproval,
      })
    );

    expect(approve).not.toHaveBeenCalled();
  }
});

test("outside the sandbox beside a live account the model is not asked, and a conversation that lets every call run allows nothing", async () => {
  const reach = { sandboxed: false, live: true };
  const auto = setup({ reach, risk: 0.01 });

  await auto.allow(ApprovalMode.Auto);
  await vi.waitFor(() =>
    expect(auto.call()).toMatchObject({
      status: ToolCallStatus.AwaitingApproval,
    })
  );

  expect(auto.judge).not.toHaveBeenCalled();

  const bypass = setup({ reach });

  await bypass.allow(ApprovalMode.Bypass);
  await bypass.ended();

  expect(bypass.approve).not.toHaveBeenCalled();
  expect(bypass.call()).toMatchObject({ status: ToolCallStatus.Error });
});

test("a conversation that lets every call run allows a version in the sandbox as its mode's", async () => {
  const { ended, allow, approve } = setup();

  await allow(ApprovalMode.Bypass);
  await ended();

  expect(approve).toHaveBeenCalledWith(
    "crossing",
    VERSION,
    StrategyApprover.Mode
  );
});

test("a version the files have left is refused, and one already allowed answers without asking", async () => {
  const stale = setup();

  await stale.allow(ApprovalMode.Ask, "0000");
  await stale.ended();

  expect(stale.call()).toMatchObject({ status: ToolCallStatus.Error });
  expect(stale.approve).not.toHaveBeenCalled();

  const allowed = setup({
    strategy: {
      ...CROSSING,
      allowed: {
        name: "crossing",
        version: VERSION,
        by: StrategyApprover.User,
        outside: false,
        at: 0,
      },
    },
  });

  await allowed.allow();
  await allowed.ended();

  expect(allowed.call()).toMatchObject({ status: ToolCallStatus.Ok });
  expect(allowed.approve).not.toHaveBeenCalled();
});

test("a new strategy waits for the user, and saving it allows the version it makes as theirs", async () => {
  const { runtime, call, ended, run, save, approve, results } = setup();

  const id = await run(ApprovalMode.Ask, AgentToolName.SaveStrategy, {
    name: "breakout",
    files: NEW_FILES,
  });

  await vi.waitFor(() =>
    expect(call()).toMatchObject({ status: ToolCallStatus.AwaitingApproval })
  );

  const waiting = call();

  if (waiting?.kind !== AgentItemKind.Tool) throw new Error("No call");

  expect(save).not.toHaveBeenCalled();

  runtime.approve(id, waiting.toolCallId, true);
  await ended();

  const version = drafted("breakout", { files: NEW_FILES, remove: [] }, null);

  expect(save).toHaveBeenCalledWith("breakout", undefined, {
    files: NEW_FILES,
    remove: [],
  });
  expect(approve).toHaveBeenCalledWith(
    "breakout",
    version,
    StrategyApprover.User
  );
  expect(call()).toMatchObject({ status: ToolCallStatus.Ok });
  expect(results).toEqual([
    `Saved breakout as version ${version}, which may now run in the sandbox.`,
  ]);
});

test("in auto, a new strategy and this conversation's own save unasked once the model finds the code harmless, while a change to the user's own asks", async () => {
  const { calls, run, judge, approve } = setup({ risk: 0.1 });
  const first = drafted("breakout", { files: NEW_FILES, remove: [] }, null);
  const edit = [{ path: "strategy.py", text: "print('better lines')" }];

  await run(
    ApprovalMode.Auto,
    AgentToolName.SaveStrategy,
    { name: "breakout", files: NEW_FILES },
    { name: "breakout", version: first, files: edit },
    { name: "crossing", version: VERSION, files: edit }
  );

  await vi.waitFor(() =>
    expect(calls().map((each) => each.status)).toEqual([
      ToolCallStatus.Ok,
      ToolCallStatus.Ok,
      ToolCallStatus.AwaitingApproval,
    ])
  );

  expect(judge).toHaveBeenCalledTimes(2);
  expect(approve.mock.calls.map(([name, , by]) => [name, by])).toEqual([
    ["breakout", StrategyApprover.Check],
    ["breakout", StrategyApprover.Check],
  ]);
});

test("outside the sandbox beside a live account the model is not asked, and a save that lets every call run writes the files but allows nothing", async () => {
  const reach = { sandboxed: false, live: true };
  const auto = setup({ reach, risk: 0.01 });

  await auto.run(ApprovalMode.Auto, AgentToolName.SaveStrategy, {
    name: "breakout",
    files: NEW_FILES,
  });
  await vi.waitFor(() =>
    expect(auto.call()).toMatchObject({
      status: ToolCallStatus.AwaitingApproval,
    })
  );

  expect(auto.judge).not.toHaveBeenCalled();

  const bypass = setup({ reach });

  await bypass.run(ApprovalMode.Bypass, AgentToolName.SaveStrategy, {
    name: "breakout",
    files: NEW_FILES,
  });
  await bypass.ended();

  expect(bypass.save).toHaveBeenCalledOnce();
  expect(bypass.approve).not.toHaveBeenCalled();
  expect(bypass.call()).toMatchObject({ status: ToolCallStatus.Ok });
  expect(bypass.results[0]).toContain("only the user allows a strategy's code");
});

test("a change to files that left the version read is refused before the user is asked, and one that leaves an allowed strategy as it is answers unasked", async () => {
  const stale = setup();

  await stale.run(ApprovalMode.Ask, AgentToolName.SaveStrategy, {
    name: "crossing",
    version: "0000",
    files: NEW_FILES,
  });
  await stale.ended();

  expect(stale.call()).toMatchObject({ status: ToolCallStatus.Error });
  expect(stale.save).not.toHaveBeenCalled();

  const allowed = setup({
    strategy: {
      ...CROSSING,
      allowed: {
        name: "crossing",
        version: VERSION,
        by: StrategyApprover.User,
        outside: false,
        at: 0,
      },
    },
  });

  await allowed.run(ApprovalMode.Ask, AgentToolName.SaveStrategy, {
    name: "crossing",
    version: VERSION,
    files: [],
  });
  await allowed.ended();

  expect(allowed.call()).toMatchObject({ status: ToolCallStatus.Ok });
  expect(allowed.save).not.toHaveBeenCalled();
});

test("with no strategy written, the agent is offered saving one and reading the interpreters, which it is told of", async () => {
  const { call, ended, run, results, tools } = setup({ listed: false });

  expect(
    tools.extension((tool) => tool, false).tools?.map((tool) => tool.name)
  ).toEqual([AgentToolName.SaveStrategy, AgentToolName.GetRuntimes]);

  await run(ApprovalMode.Ask, AgentToolName.GetRuntimes, {});
  await ended();

  expect(call()).toMatchObject({ status: ToolCallStatus.Ok });
  expect(results[0]).toContain(
    "- python3: Python 3.12.1, with numpy 2.1.0\n- node: v22.0.0"
  );
});
