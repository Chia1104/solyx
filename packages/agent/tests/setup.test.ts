import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { contentText } from "@earendil-works/pi-ai";
import type {
  ToolExecutionApi,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import { expect, test, vi } from "vite-plus/test";

import type { ToolGuard } from "../src/approval.ts";
import { createSetupTools } from "../src/setup.ts";
import type { SetupPort } from "../src/setup.ts";
import { AgentToolName } from "../src/wire.ts";

function setup() {
  const port = {
    read: vi.fn<SetupPort["read"]>(async () => [
      {
        name: "Market data",
        link: "#/settings?section=market-data",
        missing: ["Taiwan has no source to read: save a Fugle API key"],
        settings: [
          {
            name: "marketData.TW",
            value: "fugle",
            description: "Where Taiwan charts come from.",
            accepts: "one of fugle, fubon",
          },
          { name: "Fugle API key", value: "missing" },
        ],
      },
      {
        name: "About",
        link: "#/settings?section=about",
        missing: [],
        settings: [{ name: "version", value: "0.9.0" }],
      },
    ]),
    check: vi.fn<SetupPort["check"]>(async () => undefined),
    change: vi.fn<SetupPort["change"]>(async () => undefined),
  };

  /** The tools the user was asked about, in order; each is allowed. */
  const asked: string[] = [];

  const guard: ToolGuard = (tool) => ({
    ...tool,
    async execute(params, api, context) {
      asked.push(tool.name);

      return tool.execute(params, api, context);
    },
  });

  const [getSetup, changeSetting] =
    createSetupTools({ setup: port, guard }).tools ?? [];

  const run = async (
    tool: ToolRegistration,
    params: Parameters<ToolRegistration["execute"]>[0]
  ) => {
    // SAFETY: neither tool uses its call's api.
    const result = await tool.execute(
      params,
      {} as ToolExecutionApi,
      BACKGROUND_CONTEXT
    );

    return contentText(result.content ?? []);
  };

  return { port, asked, getSetup, changeSetting, run };
}

test("reads each tab's settings and what keeps it from working, with its link", async () => {
  const { getSetup, run, asked } = setup();

  expect(getSetup.name).toBe(AgentToolName.GetSetup);
  expect(getSetup.replay).toBe("safe");

  expect((await run(getSetup, {})).split("\n")).toEqual([
    "Solyx setup by settings tab. Link a tab in your reply as a markdown link to its link, named as the app names it in the reply's language.",
    "",
    "## Market data (link: #/settings?section=market-data)",
    "Missing: Taiwan has no source to read: save a Fugle API key",
    "- marketData.TW: fugle (Where Taiwan charts come from.); change_setting takes one of fugle, fubon",
    "- Fugle API key: missing",
    "",
    "## About (link: #/settings?section=about)",
    "- version: 0.9.0",
  ]);
  expect(asked).toEqual([]);
});

test("a change waits for the user, then the host makes it", async () => {
  const { port, changeSetting, run, asked } = setup();
  const change = { setting: "agent.thinking", value: "high" };

  expect(changeSetting.name).toBe(AgentToolName.ChangeSetting);
  expect(changeSetting.replay).toBe("safe");

  expect(await run(changeSetting, change)).toBe("agent.thinking is now high.");
  expect(port.check).toHaveBeenCalledWith(change);
  expect(asked).toEqual([AgentToolName.ChangeSetting]);
  expect(port.change).toHaveBeenCalledWith(change);
});

test("a change the host refuses fails before the user is asked", async () => {
  const { port, changeSetting, run, asked } = setup();

  port.check.mockRejectedValue(
    new Error("agent.shell is not a setting change_setting takes")
  );

  await expect(
    run(changeSetting, { setting: "agent.shell", value: "true" })
  ).rejects.toThrow("agent.shell is not a setting change_setting takes");
  expect(asked).toEqual([]);
  expect(port.change).not.toHaveBeenCalled();
});
