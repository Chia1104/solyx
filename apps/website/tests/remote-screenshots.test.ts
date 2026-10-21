import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test, vi } from "vite-plus/test";

import { readRemoteScreenshots } from "../src/lib/remote-screenshots.ts";
import { SCREENSHOT_ASSETS_URL } from "../src/lib/screenshots.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("the build offers what the host holds or gives no answer for, and fails on neither", async () => {
  const docsDir = await mkdtemp(join(tmpdir(), "solyx-docs-"));

  try {
    await mkdir(join(docsDir, "images"));
    await writeFile(join(docsDir, "images", "agent.light.png"), "");
    await writeFile(
      join(docsDir, "agent.mdx"),
      '<Screenshot file="agent.png" alt="The agent" />'
    );
    await writeFile(
      join(docsDir, "agent.zh-TW.mdx"),
      '<Screenshot\n  file="agent.png"\n  alt="Agent"\n/>'
    );

    const asked: string[] = [];

    vi.stubGlobal("fetch", async (url: string) => {
      const path = url.slice(SCREENSHOT_ASSETS_URL.length + 1);

      asked.push(path);

      if (path === "agent.zh-TW.light.png") throw new TypeError("fetch failed");

      const status = { "agent.png": 200, "agent.dark.png": 500 }[path] ?? 404;

      return new Response(null, { status });
    });

    await expect(readRemoteScreenshots(docsDir)).resolves.toEqual({
      offered: ["agent.dark.png", "agent.png", "agent.zh-TW.light.png"],
      unanswered: ["agent.dark.png", "agent.zh-TW.light.png"],
    });
    expect(asked).not.toContain("agent.light.png");
  } finally {
    await rm(docsDir, { recursive: true });
  }
});
