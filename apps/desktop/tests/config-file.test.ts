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

const fuglePlan = (config: ReturnType<typeof createConfigFile>) =>
  config.read().providers?.fugle?.plan;

test("a new file starts from a commented template on Fugle's free plan", async () => {
  const config = createConfigFile(file);

  expect(fuglePlan(config)).toBeUndefined();

  config.create();

  expect(config.read().marketData?.TW).toBe("fugle");
  expect(fuglePlan(config)).toBe("basic");
  // The template's empty paths read as not chosen.
  expect(config.read().providers?.fubon).toEqual({
    sdk: undefined,
    certificate: undefined,
  });
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

  expect(fuglePlan(config)).toBe("developer");

  config.set(["providers", "fugle", "plan"], "advanced");
  config.set(["providers", "fubon", "sdk"], "/sdk/package");

  const text = await readFile(file, "utf8");

  expect(fuglePlan(config)).toBe("advanced");
  expect(config.read().providers?.fubon?.sdk).toBe("/sdk/package");
  expect(text).toContain("// my notes");
  expect(text).toContain('"theme": "dark", // kept');
  expect(text).toContain('"region": "tw"');
});

test("a file with syntax errors reads as defaults and is never overwritten", async () => {
  const config = createConfigFile(file);
  const broken = '{ "providers": { "fugle": { "plan": "developer" }';

  config.create();
  await writeFile(file, broken);

  expect(fuglePlan(config)).toBeUndefined();
  expect(() => config.set(["providers", "fugle", "plan"], "basic")).toThrow(
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

  expect(fuglePlan(config)).toBe("advanced");
});

test("an entry of the wrong shape reads as missing and leaves the rest in force", async () => {
  const config = createConfigFile(file);

  config.create();
  await writeFile(
    file,
    JSON.stringify({
      marketData: { TW: 5 },
      providers: {
        fugle: "developer",
        fubon: { sdk: "/sdk", certificate: [] },
      },
    })
  );

  expect(config.read()).toMatchObject({
    marketData: { TW: undefined },
    providers: {
      fugle: undefined,
      fubon: { sdk: "/sdk", certificate: undefined },
    },
  });
});
