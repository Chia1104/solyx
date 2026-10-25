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
import type { StrategyApproval, StrategyReach } from "@solyx/core/strategy";

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
}: {
  reach?: StrategyReach;
  risk?: number;
  strategy?: StrategyView;
} = {}) {
  const faux = fauxProvider();
  const models = createModels();
  const events: AgentWireEvent[] = [];
  const prompts: string[] = [];

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

  const port: StrategiesPort = {
    catalog: async () => ({ strategies: [strategy], reach, problems: [] }),
    lines: vi.fn(),
    approve,
    judge,
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
      offered: [tools.extension(guard)],
      deferred: [],
    }),
    onEvent: (_sessionId, event) => events.push(event),
  });

  closers.push(() => runtime.close());

  const done: FauxResponseFactory = (context) => {
    prompts.push(getCurrentSystemPrompt(context.messages));

    return fauxAssistantMessage("Done.");
  };

  const call = () =>
    foldEvents(events).items.find((item) => item.kind === AgentItemKind.Tool);

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

  return { runtime, call, ended, allow, approve, judge, prompts };
}

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
