import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import { createConfigFile } from "../src/main/modules/settings/config-file.ts";

let directory: string;

let file: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-config-"));
  file = join(directory, "config.json");
});

afterEach(() => rm(directory, { recursive: true, force: true }));

test("a missing file has no saved plans", () => {
  expect(createConfigFile(file).providerPlan("fugle")).toBeUndefined();
});

test("a saved plan is written as readable JSON and read back", async () => {
  const config = createConfigFile(file);

  config.setProviderPlan("fugle", "developer");
  config.setProviderPlan("fugle", "advanced");

  expect(config.providerPlan("fugle")).toBe("advanced");
  expect(await readFile(file, "utf8")).toBe(
    `${JSON.stringify({ providers: { fugle: { plan: "advanced" } } }, null, 2)}\n`
  );

  if (process.platform !== "win32") {
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  }
});

test("hand edits apply to the next read and survive a save", async () => {
  const config = createConfigFile(file);

  await writeFile(
    file,
    JSON.stringify({
      note: "kept",
      providers: {
        fugle: { plan: "developer", region: "tw" },
        other: { plan: "pro" },
      },
    })
  );

  expect(config.providerPlan("fugle")).toBe("developer");

  config.setProviderPlan("fugle", "basic");

  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
    note: "kept",
    providers: {
      fugle: { plan: "basic", region: "tw" },
      other: { plan: "pro" },
    },
  });
});

test("a file that no longer parses counts as empty until the next save", async () => {
  const config = createConfigFile(file);

  await writeFile(file, "{ not json");

  expect(config.providerPlan("fugle")).toBeUndefined();

  config.setProviderPlan("fugle", "developer");

  expect(config.providerPlan("fugle")).toBe("developer");
});
