import { expect, test } from "vite-plus/test";

import {
  ScreenshotTheme,
  screenshotCandidates,
} from "../src/lib/screenshots.ts";

test("an English page looks for its scheme's shot, then either, then the other scheme's", () => {
  expect(
    screenshotCandidates("settings/agent.png", undefined, ScreenshotTheme.Dark)
  ).toEqual([
    "settings/agent.dark.png",
    "settings/agent.png",
    "settings/agent.light.png",
  ]);
});

test("a translated page looks for a shot in its language before one in English", () => {
  expect(
    screenshotCandidates("settings/agent.png", "zh-TW", ScreenshotTheme.Light)
  ).toEqual([
    "settings/agent.zh-TW.light.png",
    "settings/agent.zh-TW.png",
    "settings/agent.zh-TW.dark.png",
    "settings/agent.light.png",
    "settings/agent.png",
    "settings/agent.dark.png",
  ]);
});
