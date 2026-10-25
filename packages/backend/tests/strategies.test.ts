import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import {
  SANDBOX_SUPPORTED,
  createSandbox,
  sandboxProblems,
} from "@solyx/agent/sandbox";
import { backtest } from "@solyx/core/backtest";
import type { Candle } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";
import { StrategyApprover, approvalAllows } from "@solyx/core/strategy";
import type { StrategyApproval, StrategyReach } from "@solyx/core/strategy";
import { kernel } from "@solyx/kernel/kernel";

import { createSecretStore } from "../src/modules/settings/secret-store.ts";
import { createStrategies } from "../src/modules/strategies/strategies.ts";
import {
  KEPT_VERSIONS,
  createStrategyApprovals,
} from "../src/modules/strategies/strategy-approvals.ts";
import {
  readStrategies,
  strategyFiles,
} from "../src/modules/strategies/strategy-folder.ts";
import { createStrategyRunner } from "../src/modules/strategies/strategy-runner.ts";

import { fakeCipher } from "./fake-cipher.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

// The strategies below are Node scripts; Windows runs them through PowerShell all the same.
const posix = test.skipIf(process.platform === "win32");

// The sandbox runs where the system has one and what it needs is there, as CI may not have it.
const sandboxed = test.runIf(
  SANDBOX_SUPPORTED && (await sandboxProblems()).length === 0
);

let directory: string;

let folder: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-strategies-"));
  folder = join(directory, "config", "strategies");
  await mkdir(folder, { recursive: true });
});

afterEach(() => rm(directory, { recursive: true, force: true }));

/** Daily bars from 2026-01-05, waving so a close crosses its own average, none locked at a limit. */
const bars = (count: number): Candle[] =>
  Array.from({ length: count }, (_, index) => {
    const close = 100 + 10 * Math.sin(index / 6);

    return {
      time: Date.UTC(2026, 0, 5 + index, 1) / 1000,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000,
    };
  });

/** Its close and the mean of its last `period` closes, as a strategy's code would work them out. */
const CROSSING = `
import { readFileSync, writeFileSync } from "node:fs";

const input = JSON.parse(readFileSync(process.env.SOLYX_STRATEGY_INPUT, "utf8"));
const output = {};

for (const job of input.jobs) {
  const close = input.bars.close.slice(0, job.bars);
  const mean = close.map((_, index) =>
    index + 1 < job.params.period
      ? null
      : close.slice(index + 1 - job.params.period, index + 1).reduce((a, b) => a + b, 0) / job.params.period
  );

  output[job.id] = { close, mean };
}

writeFileSync(process.env.SOLYX_STRATEGY_OUTPUT, JSON.stringify(output));
`;

const MANIFEST = `---
name: crossing
description: Holds while the close stands above its own average
run: node strategy.mjs
params:
  period:
    min: 2
    max: 30
    step: 1
    initial: 10
rules:
  entry:
    crossesAbove: [{ line: close }, { line: mean }]
  exit:
    crossesBelow: [{ line: close }, { line: mean }]
---

Reads the close against its mean.
`;

async function writeStrategy(
  name = "crossing",
  code = CROSSING,
  manifest = MANIFEST
) {
  await mkdir(join(folder, name), { recursive: true });
  await writeFile(join(folder, name, "STRATEGY.md"), manifest);
  await writeFile(join(folder, name, "strategy.mjs"), code);
}

function setup(reach: StrategyReach = { sandboxed: false, live: false }) {
  const secrets = createSecretStore(
    join(directory, "secrets.json"),
    fakeCipher().cipher
  );

  const approvals = createStrategyApprovals(secrets);
  const changes: number[] = [];

  const strategies = createStrategies({
    folder,
    runner: createStrategyRunner({
      runs: join(directory, "runs"),
      sandbox: undefined,
      sandboxed: () => false,
      path: async () => process.env.PATH,
    }),
    approvals,
    reach: () => reach,
    onChange: () => changes.push(1),
    now: () => new Date("2026-10-26T02:00:00Z"),
  });

  return { strategies, approvals, secrets, changes, reach };
}

describe("a strategy's folder", () => {
  test("holds its manifest, its notes and a version of every file", async () => {
    await writeStrategy();

    const { strategies, problems } = await readStrategies(folder);

    expect(problems).toEqual([]);
    expect(strategies).toMatchObject([
      {
        manifest: { name: "crossing", run: "node strategy.mjs" },
        notes: "Reads the close against its mean.",
      },
    ]);
    expect(strategyFiles(strategies[0])).toEqual([
      { path: "STRATEGY.md", bytes: MANIFEST.length },
      { path: "strategy.mjs", bytes: CROSSING.length },
    ]);
  });

  test("is another version once any file it holds changes, but not for what tools keep beside it", async () => {
    await writeStrategy();

    const version = async () =>
      (await readStrategies(folder)).strategies[0].version;

    const first = await version();

    await mkdir(join(folder, "crossing", "__pycache__"));
    await writeFile(join(folder, "crossing", "__pycache__", "x.pyc"), "x");
    await mkdir(join(folder, "crossing", ".git"));
    await writeFile(join(folder, "crossing", ".git", "HEAD"), "x");

    expect(await version()).toBe(first);

    await mkdir(join(folder, "crossing", "lib"));
    await writeFile(join(folder, "crossing", "lib", "helper.mjs"), "export {}");

    const second = await version();

    expect(second).not.toBe(first);

    await writeFile(
      join(folder, "crossing", "lib", "helper.mjs"),
      "export {};"
    );

    expect(await version()).not.toBe(second);
  });

  test("refuses a link, since what it points to could change while the version stays", async () => {
    await writeStrategy();
    await writeFile(join(directory, "a.txt"), "a");
    await symlink(join(directory, "a.txt"), join(folder, "crossing", "data"));

    expect(await readStrategies(folder)).toEqual({
      strategies: [],
      problems: [
        `${join(folder, "crossing", "STRATEGY.md")}: holds a link at data; copy what it points to into the folder instead`,
      ],
    });
  });

  test("whose STRATEGY.md does not read, or names another strategy, is a problem rather than a strategy", async () => {
    await writeStrategy("broken", "", "no frontmatter");
    await writeStrategy("other", CROSSING, MANIFEST);
    await mkdir(join(folder, "notes"));

    const { strategies, problems } = await readStrategies(folder);

    expect(strategies).toEqual([]);
    expect(problems).toEqual([
      `${join(folder, "broken", "STRATEGY.md")}: STRATEGY.md opens with no frontmatter between --- lines`,
      `${join(folder, "other", "STRATEGY.md")}: name "crossing" does not match its folder "other"`,
    ]);
  });
});

describe("an approval", () => {
  const approval = (
    by: StrategyApprover,
    outside: boolean
  ): StrategyApproval => ({
    name: "crossing",
    version: "v1",
    by,
    outside,
    at: 0,
  });

  test("lets a version run in the sandbox whoever gave it, outside only where given for there, and beside a live account outside only the user's", () => {
    const places: StrategyReach[] = [
      { sandboxed: true, live: true },
      { sandboxed: false, live: false },
      { sandboxed: false, live: true },
    ];

    const allows = (by: StrategyApprover, outside: boolean) =>
      places.map((reach) => approvalAllows(approval(by, outside), reach));

    expect(allows(StrategyApprover.Check, false)).toEqual([true, false, false]);
    expect(allows(StrategyApprover.Check, true)).toEqual([true, true, false]);
    expect(allows(StrategyApprover.Mode, true)).toEqual([true, true, false]);
    expect(allows(StrategyApprover.User, true)).toEqual([true, true, true]);
  });

  test("is sealed with the secrets, and a strategy keeps its newest versions", async () => {
    const { approvals } = setup();

    for (let index = 0; index <= KEPT_VERSIONS; index++) {
      await approvals.approve({
        ...approval(StrategyApprover.User, true),
        version: `v${index}`,
        at: index,
      });
    }

    await approvals.approve({
      ...approval(StrategyApprover.Check, false),
      name: "other",
    });

    const kept = await approvals.list();

    expect(kept.map((each) => `${each.name}@${each.version}`)).toEqual([
      "other@v1",
      ...Array.from(
        { length: KEPT_VERSIONS },
        (_, index) => `crossing@v${KEPT_VERSIONS - index}`
      ),
    ]);

    await approvals.revoke("crossing");

    expect((await approvals.list()).map((each) => each.name)).toEqual([
      "other",
    ]);
  });
});

describe("a strategy's lines", () => {
  posix(
    "are its code's, once its version as it is now is allowed, and trade as the engine's rules read them",
    async () => {
      await writeStrategy();

      const { strategies, changes } = setup();
      const history = bars(120);

      const lines = () =>
        strategies.lines("crossing", TSMC, history, {}, [{ period: 8 }, {}]);

      await expect(lines()).rejects.toThrow(
        "crossing has not been allowed to run as its files are now outside the sandbox"
      );

      const {
        strategies: [entry],
      } = await strategies.catalog();

      expect(entry.allowed).toBeNull();

      await strategies.approve(
        "crossing",
        entry.version,
        StrategyApprover.User
      );

      expect(changes).toHaveLength(1);
      expect((await strategies.catalog()).strategies[0].allowed).toMatchObject({
        by: StrategyApprover.User,
        outside: true,
      });

      const worked = await lines();

      expect(worked.params).toEqual([{ period: 8 }, { period: 10 }]);
      expect(worked.lookAhead).toBeNull();
      expect(worked.lines[0].mean.slice(0, 8)).toEqual([
        ...Array.from({ length: 7 }, () => null),
        expect.any(Number),
      ]);

      const result = await backtest(kernel, TSMC, history, worked.rules, {
        lines: worked.lines[0],
      });

      expect(result.trades.length).toBeGreaterThan(2);

      await writeFile(
        join(folder, "crossing", "strategy.mjs"),
        `${CROSSING}\n`
      );

      await expect(lines()).rejects.toThrow("has not been allowed");
    }
  );

  posix("warn where the code read later bars, at that bar's time", async () => {
    await writeStrategy(
      "crossing",
      CROSSING.replace(
        "output[job.id] = { close, mean };",
        "output[job.id] = { close, mean: close.map((_, index) => close[index + 1] ?? null) };"
      )
    );

    const { strategies } = setup();

    const {
      strategies: [entry],
    } = await strategies.catalog();

    await strategies.approve("crossing", entry.version, StrategyApprover.Check);

    const worked = await strategies.lines("crossing", TSMC, bars(100), {}, [
      {},
    ]);

    expect(worked.lookAhead).toEqual({ line: "mean", time: "2026-01-24" });
  });

  posix(
    "beside a live account outside the sandbox, run only on the user's own approval",
    async () => {
      await writeStrategy();

      const { strategies } = setup({ sandboxed: false, live: true });

      const {
        strategies: [entry],
      } = await strategies.catalog();

      await strategies.approve(
        "crossing",
        entry.version,
        StrategyApprover.Check
      );

      await expect(
        strategies.lines("crossing", TSMC, bars(60), {}, [{}])
      ).rejects.toThrow("which only the user allows");

      await strategies.approve(
        "crossing",
        entry.version,
        StrategyApprover.User
      );

      await expect(
        strategies.lines("crossing", TSMC, bars(60), {}, [{}])
      ).resolves.toMatchObject({ lookAhead: null });
    }
  );

  test("refuse a version other than the strategy's files are now", async () => {
    await writeStrategy();

    const { strategies } = setup();

    await expect(
      strategies.approve("crossing", "stale", StrategyApprover.User)
    ).rejects.toThrow("crossing's files changed since that version");
    await expect(
      strategies.lines("missing", TSMC, bars(10), {}, [{}])
    ).rejects.toThrow("No strategy is named missing");
  });
});

describe("a strategy's run", () => {
  const strategy = async (code: string) => {
    await writeStrategy("crossing", code);

    return (await readStrategies(folder)).strategies[0];
  };

  const input = {
    symbol: TSMC,
    interval: "1d" as const,
    bars: {
      time: ["2026-01-05"],
      open: [1],
      high: [1],
      low: [1],
      close: [1],
      volume: [1],
    },
    jobs: [{ id: "run0", params: {}, bars: 1 }],
  };

  const runner = (timeoutMs?: number) =>
    createStrategyRunner({
      runs: join(directory, "runs"),
      sandbox: undefined,
      sandboxed: () => false,
      path: async () => process.env.PATH,
      timeoutMs,
    });

  posix(
    "fails with the end of what the code printed, and leaves nothing of its folder behind",
    async () => {
      const failing = await strategy(
        `console.error("no data for this listing"); process.exit(3);`
      );

      await expect(runner().run(failing, input)).rejects.toThrow(
        "The strategy's code exited with 3; it printed:\nno data for this listing"
      );
      expect(await readdir(join(directory, "runs"))).toEqual([]);
    }
  );

  posix(
    "runs the files as they were read, whatever the folder holds by then",
    async () => {
      const read = await strategy(
        `import { writeFileSync } from "node:fs"; writeFileSync(process.env.SOLYX_STRATEGY_OUTPUT, JSON.stringify({ run0: {} }));`
      );

      await writeFile(
        join(folder, "crossing", "strategy.mjs"),
        "process.exit(5);"
      );

      await expect(runner().run(read, input)).resolves.toEqual([{}]);
    }
  );

  posix(
    "fails once the code writes no lines, or runs past its time",
    async () => {
      await expect(runner().run(await strategy(""), input)).rejects.toThrow(
        "ended without writing its lines"
      );
      await expect(
        runner(300).run(await strategy("setInterval(() => {}, 1000);"), input)
      ).rejects.toThrow("The strategy's code ran past 0.3 seconds");
    }
  );

  sandboxed(
    "in the sandbox, reads its own folder but nothing else of the home, and reaches no network",
    async () => {
      const home = join(directory, "home");

      await mkdir(home);
      await writeFile(join(home, "diary.txt"), "diary-secret");

      const box = createSandbox({
        home,
        appFolders: [join(directory, "config")],
      });

      try {
        const code = `
import { readFileSync, writeFileSync } from "node:fs";

const tried = (read) => { try { read(); return "read"; } catch { return "refused"; } };
const diary = tried(() => readFileSync(${JSON.stringify(join(home, "diary.txt"))}));
const own = tried(() => readFileSync("STRATEGY.md"));
const network = await fetch("https://example.com").then(() => "reached", () => "refused");

writeFileSync(process.env.SOLYX_STRATEGY_OUTPUT, JSON.stringify({ run0: {} }));
console.error([diary, own, network].join(" "));
process.exit(diary === "refused" && own === "read" && network === "refused" ? 0 : 9);
`;

        const run = createStrategyRunner({
          runs: join(directory, "runs"),
          sandbox: box,
          sandboxed: () => true,
          path: async () => process.env.PATH,
        });

        await expect(run.run(await strategy(code), input)).resolves.toEqual([
          {},
        ]);
      } finally {
        await box.close();
      }
    }
  );
});
