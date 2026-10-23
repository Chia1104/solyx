import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vite-plus/test";

import { loadSkillCatalog } from "@solyx/agent/skills";

const kit = await readFile(
  new URL("../src/modules/agent/agent-canvas.css", import.meta.url),
  "utf8"
);

async function playbook(): Promise<string> {
  const nowhere = join(tmpdir(), "solyx-no-skills");

  const { skills } = await loadSkillCatalog(
    { solyx: nowhere, shared: nowhere },
    new Set()
  );

  return skills.find((skill) => skill.name === "canvas")?.body ?? "";
}

const found = (text: string, pattern: RegExp) => [
  ...new Set([...text.matchAll(pattern)].flatMap((match) => match.slice(1))),
];

// Classes the playbook names in a sentence, by the words that name them.
const NAMED = {
  key: "Class key",
  rest: "Class rest",
  tw: "class tw or us",
  us: "class tw or us",
};

test("every class the canvas playbook writes or names is one the kit draws", async () => {
  const body = await playbook();

  const written = found(body, /class="([^"]+)"/g).flatMap((names) =>
    names.split(" ")
  );

  expect(written).toEqual(
    expect.arrayContaining(["bars", "cols", "shares", "ranges", "line", "keys"])
  );

  for (const [name, words] of Object.entries(NAMED)) {
    expect(body, name).toContain(words);
  }

  for (const name of new Set([...written, ...Object.keys(NAMED)])) {
    expect(kit, name).toMatch(new RegExp(`\\.${name}\\b`));
  }
});

test("every figure the playbook's marks are given is one the kit sizes them from", async () => {
  const figures = found(
    found(await playbook(), /style="([^"]+)"/g).join(";"),
    /(--[a-z]+):/g
  );

  expect(figures.toSorted()).toEqual([
    "--a",
    "--b",
    "--hi",
    "--lo",
    "--max",
    "--min",
    "--v",
  ]);

  for (const figure of figures) {
    expect(kit, figure).toContain(`var(${figure}`);
  }
});
