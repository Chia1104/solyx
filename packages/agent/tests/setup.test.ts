import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { contentText } from "@earendil-works/pi-ai";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { expect, test, vi } from "vite-plus/test";

import { createSetupTools } from "../src/setup.ts";
import type { SetupPort } from "../src/setup.ts";
import { AgentToolName } from "../src/wire.ts";

test("reads each tab's settings and what keeps it from working, with its link", async () => {
  const setup = {
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
  };

  const [tool] = createSetupTools({ setup }).tools ?? [];

  expect(tool.name).toBe(AgentToolName.GetSetup);
  expect(tool.replay).toBe("safe");

  // SAFETY: get_setup never uses its call's api.
  const result = await tool.execute(
    {},
    {} as ToolExecutionApi,
    BACKGROUND_CONTEXT
  );

  expect(contentText(result.content ?? []).split("\n")).toEqual([
    "Solyx setup by settings tab. Link a tab in your reply as a markdown link to its link, named as the app names it in the reply's language.",
    "",
    "## Market data (link: #/settings?section=market-data)",
    "Missing: Taiwan has no source to read: save a Fugle API key",
    "- marketData.TW: fugle (Where Taiwan charts come from.)",
    "- Fugle API key: missing",
    "",
    "## About (link: #/settings?section=about)",
    "- version: 0.9.0",
  ]);
});
