import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { PromptInput } from "@earendil-works/pi-durable";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import { promptSections } from "../src/prompt.ts";
import { SkillSource } from "../src/skill-source.ts";
import { loadInstructions, loadSkillCatalog } from "../src/skills.ts";
import type { SkillFolders } from "../src/skills.ts";

let root: string;

let folders: SkillFolders;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "solyx-skills-"));
  folders = {
    solyx: join(root, ".solyx", "skills"),
    shared: join(root, ".agents", "skills"),
  };
});

afterEach(() => rm(root, { recursive: true, force: true }));

async function writeSkill(
  folder: string,
  name: string,
  description: string,
  extra = ""
) {
  await mkdir(join(folder, name), { recursive: true });
  await writeFile(
    join(folder, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n# ${name}\n`
  );
}

const offered = (catalog: Awaited<ReturnType<typeof loadSkillCatalog>>) =>
  catalog.skills.filter((skill) => skill.offered).map((skill) => skill.name);

test("with no folders the built-in playbooks are offered", async () => {
  const catalog = await loadSkillCatalog(folders, new Set());

  expect(offered(catalog)).toEqual([
    "order-proposal",
    "technical-read",
    "taiwan-market",
    "us-market",
    "portfolio-review",
    "deep-analysis",
    "views",
    "solyx-guide",
  ]);
  expect(catalog.warnings).toEqual([]);
});

test("the user's own skills come first and replace a built-in of the same name", async () => {
  await writeSkill(folders.solyx, "order-proposal", "My way to propose");
  await writeSkill(folders.solyx, "dividend-check", "Before ex-dividend dates");

  const catalog = await loadSkillCatalog(folders, new Set());
  const mine = catalog.skills.find((skill) => skill.name === "order-proposal");

  expect(offered(catalog).slice(0, 2)).toEqual([
    "dividend-check",
    "order-proposal",
  ]);
  expect(mine).toMatchObject({
    source: SkillSource.Solyx,
    description: "My way to propose",
    body: "# order-proposal",
  });
  expect(
    offered(catalog).filter((name) => name === "order-proposal")
  ).toHaveLength(1);
});

test("shared skills are offered only once switched on, and never over a playbook", async () => {
  await writeSkill(folders.shared, "frontend-design", "UI work");
  await writeSkill(folders.shared, "macro-calendar", "Economic releases");
  await writeSkill(folders.shared, "us-market", "Someone else's notes");

  const off = await loadSkillCatalog(folders, new Set());

  expect(
    off.skills.find((skill) => skill.name === "frontend-design")
  ).toMatchObject({
    source: SkillSource.Shared,
    offered: false,
  });

  const on = await loadSkillCatalog(
    folders,
    new Set(["macro-calendar", "us-market"])
  );

  expect(offered(on)).toContain("macro-calendar");
  expect(offered(on)).not.toContain("frontend-design");
  expect(on.skills.find((skill) => skill.name === "us-market")?.source).toBe(
    SkillSource.BuiltIn
  );
});

test("hidden and broken skills are left out, the broken ones reported", async () => {
  await writeSkill(
    folders.solyx,
    "internal",
    "Hidden",
    "disable-model-invocation: true\n"
  );
  await mkdir(join(folders.solyx, "broken"), { recursive: true });
  await writeFile(
    join(folders.solyx, "broken", "SKILL.md"),
    "---\nname: broken\n---\n"
  );

  const catalog = await loadSkillCatalog(folders, new Set());

  expect(catalog.skills.map((skill) => skill.name)).not.toContain("internal");
  expect(catalog.skills.map((skill) => skill.name)).not.toContain("broken");
  expect(catalog.warnings).toHaveLength(1);
  expect(catalog.warnings[0]).toContain("broken");
});

test("standing instructions are read when present and follow the rules in the prompt", async () => {
  const file = join(root, ".solyx", "AGENTS.md");

  expect(await loadInstructions(file)).toBeUndefined();

  await mkdir(join(root, ".solyx"), { recursive: true });
  await writeFile(file, "\nRisk at most 0.5% per trade.\n");

  const instructions = await loadInstructions(file);

  const prompt = async (standing: string | undefined) => {
    const sections = promptSections({
      skills: async () => [],
      instructions: async () => standing,
    });

    // SAFETY: these sections read nothing from the request they render for.
    const input = {} as PromptInput;

    return (
      await Promise.all(
        sections.map((section) => section.render(input, BACKGROUND_CONTEXT))
      )
    ).join("\n\n");
  };

  const withInstructions = await prompt(instructions);

  expect(instructions).toBe("Risk at most 0.5% per trade.");
  expect(withInstructions.indexOf("# Orders")).toBeLessThan(
    withInstructions.indexOf("Risk at most 0.5%")
  );
  expect(await prompt(undefined)).not.toContain("standing instructions");
});

test("only problems in skills the agent may use are reported", async () => {
  const long = "x".repeat(1100);

  await writeSkill(folders.solyx, "mine", long);
  await writeSkill(folders.shared, "left-off", long);
  await writeSkill(folders.shared, "switched-on", long);

  const catalog = await loadSkillCatalog(folders, new Set(["switched-on"]));

  // Over the format's description limit, but still offered.
  expect(offered(catalog)).toEqual(
    expect.arrayContaining(["mine", "switched-on"])
  );
  expect(catalog.warnings).toHaveLength(2);
  expect(catalog.warnings.join("\n")).not.toContain("left-off");
});
