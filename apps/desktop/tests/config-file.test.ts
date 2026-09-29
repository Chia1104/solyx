import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import { createConfigFile } from "../src/main/modules/settings/config-file.ts";

let directory: string;

let file: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-config-"));
  file = join(directory, ".solyx", "config.jsonc");
});

afterEach(() => rm(directory, { recursive: true, force: true }));

test("a new file starts from a commented template on the free plan", async () => {
  const config = createConfigFile(file);

  expect(config.providerPlan("fugle")).toBeUndefined();

  config.create();

  expect(config.providerPlan("fugle")).toBe("basic");
  expect(await readFile(file, "utf8")).toMatch(/^\/\/ /);

  if (process.platform !== "win32") {
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  }
});

test("saving a plan edits it in place, keeping comments and other keys", async () => {
  const config = createConfigFile(file);

  config.create();
  await writeFile(
    file,
    [
      "// my notes",
      "{",
      '  "theme": "dark", // kept',
      '  "providers": {',
      '    "fugle": { "plan": "developer", "region": "tw" },',
      "  },",
      "}",
    ].join("\n")
  );

  expect(config.providerPlan("fugle")).toBe("developer");

  config.setProviderPlan("fugle", "advanced");

  const text = await readFile(file, "utf8");

  expect(config.providerPlan("fugle")).toBe("advanced");
  expect(text).toContain("// my notes");
  expect(text).toContain('"theme": "dark", // kept');
  expect(text).toContain('"region": "tw"');
});

test("a file with syntax errors reads as defaults and is never overwritten", async () => {
  const config = createConfigFile(file);
  const broken = '{ "providers": { "fugle": { "plan": "developer" }';

  config.create();
  await writeFile(file, broken);

  expect(config.providerPlan("fugle")).toBeUndefined();
  expect(() => config.setProviderPlan("fugle", "basic")).toThrow(
    /syntax errors/
  );
  expect(await readFile(file, "utf8")).toBe(broken);
});

test("changes made outside the app are reported", async () => {
  const config = createConfigFile(file);

  config.create();

  const changed = new Promise<void>((resolve) => {
    const stop = config.watch(() => {
      stop();
      resolve();
    });
  });

  await writeFile(file, '{ "providers": { "fugle": { "plan": "advanced" } } }');
  await changed;

  expect(config.providerPlan("fugle")).toBe("advanced");
});
