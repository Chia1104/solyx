import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
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
  draftStrategy,
  readStrategies,
  strategyFiles,
} from "../src/modules/strategies/strategy-folder.ts";
import { createStrategyRunner } from "../src/modules/strategies/strategy-runner.ts";
import { createStrategySnapshots } from "../src/modules/strategies/strategy-snapshots.ts";

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
    snapshots: createStrategySnapshots(join(directory, "versions")),
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
      {
        path: "STRATEGY.md",
        bytes: MANIFEST.length,
        digest: expect.any(String),
      },
      {
        path: "strategy.mjs",
        bytes: CROSSING.length,
        digest: expect.any(String),
      },
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

describe("a strategy's review", () => {
  test("shows its files beside those of the version allowed before, until every version is taken back", async () => {
    await writeStrategy();

    const { strategies } = setup();

    expect((await strategies.review("crossing")).previous).toBeNull();

    const {
      strategies: [first],
    } = await strategies.catalog();

    await strategies.approve("crossing", first.version, StrategyApprover.User);
    await writeFile(join(folder, "crossing", "strategy.mjs"), "// changed\n");

    const review = await strategies.review("crossing");

    expect(review.current.files[1]).toEqual({
      path: "strategy.mjs",
      bytes: 11,
      digest: expect.any(String),
      text: "// changed\n",
    });
    expect(review.previous).toEqual({
      version: first.version,
      files: [
        {
          path: "STRATEGY.md",
          bytes: MANIFEST.length,
          digest: expect.any(String),
          text: MANIFEST,
        },
        {
          path: "strategy.mjs",
          bytes: CROSSING.length,
          digest: expect.any(String),
          text: CROSSING,
        },
      ],
    });

    await strategies.revoke("crossing");

    expect((await strategies.review("crossing")).previous).toBeNull();
    expect(await readdir(join(directory, "versions", "crossing"))).toEqual([]);
  });
});

describe("a strategy's change", () => {
  const change = (
    files: { path: string; text: string }[],
    remove: string[] = []
  ) => ({ files, remove });

  const written = [
    { path: "STRATEGY.md", text: MANIFEST },
    { path: "strategy.mjs", text: CROSSING },
  ];

  test("writes a new strategy's files, giving the version a read then finds", async () => {
    const { strategies, changes } = setup();

    await rm(folder, { recursive: true });
    await expect(
      strategies.save("crossing", "v1", change(written))
    ).rejects.toThrow("No strategy is named crossing");

    const version = await strategies.save(
      "crossing",
      undefined,
      change(written)
    );

    const [read] = (await strategies.catalog()).strategies;

    expect(read).toMatchObject({ name: "crossing", version, allowed: null });
    expect(changes).toHaveLength(1);
  });

  test("keeps the files it is not given, removes those named, and leaves what tools keep alone", async () => {
    await writeStrategy();
    await mkdir(join(folder, "crossing", ".git"));
    await writeFile(join(folder, "crossing", ".git", "HEAD"), "ref");
    await writeFile(join(folder, "crossing", "notes.txt"), "kept");

    const { strategies } = setup();
    const [before] = (await strategies.catalog()).strategies;

    await strategies.save(
      "crossing",
      before.version,
      change([{ path: "lib/mean.mjs", text: "export {};\n" }], ["notes.txt"])
    );

    const [after] = (await strategies.catalog()).strategies;

    expect(after.files.map((file) => file.path)).toEqual([
      "STRATEGY.md",
      "lib/mean.mjs",
      "strategy.mjs",
    ]);
    expect(
      await readFile(join(folder, "crossing", ".git", "HEAD"), "utf8")
    ).toBe("ref");
  });

  test("is refused once the files have left the version read, but not once it was made already", async () => {
    await writeStrategy();

    const { strategies } = setup();
    const [{ version }] = (await strategies.catalog()).strategies;
    const edit = change([{ path: "strategy.mjs", text: "// edited\n" }]);

    await expect(strategies.save("crossing", undefined, edit)).rejects.toThrow(
      "crossing is a strategy already"
    );

    const saved = await strategies.save("crossing", version, edit);

    // Made again, as a call the app's exit cut off is, it changes nothing and is not refused.
    await expect(strategies.save("crossing", version, edit)).resolves.toBe(
      saved
    );

    await writeFile(join(folder, "crossing", "strategy.mjs"), "// by hand\n");

    await expect(
      strategies.save(
        "crossing",
        saved,
        change([{ path: "strategy.mjs", text: "// again\n" }])
      )
    ).rejects.toThrow("crossing's files changed since that version");
  });

  test("tells the version a read of the written files finds, whatever order their folders sort in", async () => {
    const made = change([
      ...written,
      { path: "a.mjs", text: "1" },
      { path: "a-b.mjs", text: "2" },
      { path: "a/b.mjs", text: "3" },
    ]);

    const { draft } = await draftStrategy(folder, "crossing", made);
    const { strategies } = setup();

    expect(await strategies.save("crossing", undefined, made)).toBe(
      draft.version
    );
  });

  test("is refused where the strategy would not read, or its files would land on one another", async () => {
    await writeStrategy();
    await writeStrategy("broken", "", "no frontmatter");
    await mkdir(join(folder, "notes"));

    const { strategies } = setup();
    const [{ version }] = (await strategies.catalog()).strategies;

    const refusals: [
      string,
      string | undefined,
      ReturnType<typeof change>,
      string,
    ][] = [
      [
        "fresh",
        undefined,
        change([{ path: "STRATEGY.md", text: MANIFEST }]),
        'fresh/STRATEGY.md: name "crossing" does not match its folder "fresh"',
      ],
      [
        "fresh",
        undefined,
        change([{ path: "strategy.mjs", text: CROSSING }]),
        "fresh/STRATEGY.md: STRATEGY.md is gone",
      ],
      [
        "crossing",
        version,
        change([{ path: "Strategy.mjs", text: "" }]),
        "Strategy.mjs and strategy.mjs would be one file on macOS and Windows",
      ],
      [
        "crossing",
        version,
        change([{ path: "strategy.mjs/inner.mjs", text: "" }]),
        "strategy.mjs would be a file and a folder at once",
      ],
      [
        "crossing",
        version,
        change([{ path: "x.mjs", text: "" }], ["x.mjs"]),
        "x.mjs is named twice",
      ],
      [
        "broken",
        undefined,
        change(written),
        "broken's folder does not read as a strategy, which only the user can fix",
      ],
      [
        "notes",
        undefined,
        change(written),
        "The folder notes holds no STRATEGY.md",
      ],
    ];

    for (const [name, basedOn, made, reason] of refusals) {
      await expect(strategies.save(name, basedOn, made)).rejects.toThrow(
        reason
      );
    }

    await mkdir(join(folder, "crossing", "lib"));
    await writeFile(join(folder, "crossing", "lib", "a.mjs"), "");

    const [{ version: withLib }] = (await strategies.catalog()).strategies;

    await expect(
      strategies.save("crossing", withLib, change([], ["lib"]))
    ).rejects.toThrow("lib is a folder; name each of its files to remove it");
    await expect(
      strategies.save(
        "crossing",
        withLib,
        change(
          Array.from({ length: 1001 }, (_, index) => ({
            path: `data/${index}.txt`,
            text: "",
          }))
        )
      )
    ).rejects.toThrow("crossing then holds more than 1000 files");
  });

  test("is reviewed beside the newest version allowed, or the files now where they are allowed", async () => {
    const { strategies } = setup();
    const edit = change([{ path: "strategy.mjs", text: "// edited\n" }]);

    const fresh = await strategies.reviewDraft(
      "crossing",
      undefined,
      change(written)
    );

    expect(fresh.previous).toBeNull();
    expect(fresh.current.files.map((file) => file.text)).toEqual([
      MANIFEST,
      CROSSING,
    ]);

    await writeStrategy();

    const [{ version: first }] = (await strategies.catalog()).strategies;

    await strategies.approve("crossing", first, StrategyApprover.User);

    expect(
      (await strategies.reviewDraft("crossing", first, edit)).previous?.version
    ).toBe(first);

    await writeFile(join(folder, "crossing", "strategy.mjs"), "// by hand\n");

    const [{ version: byHand }] = (await strategies.catalog()).strategies;
    const review = await strategies.reviewDraft("crossing", byHand, edit);

    // The hand edit was never allowed, so the review reaches back past it to what was.
    expect(review.previous?.version).toBe(first);
    expect(review.current.files[1].text).toBe("// edited\n");
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

  /** A folder of stand-ins for python3 and node, which say their versions and Python's numpy. */
  async function interpreters() {
    const bin = join(directory, "bin");

    await mkdir(bin);
    await writeFile(
      join(bin, "python3"),
      `#!/bin/bash\nif [ "$1" = --version ]; then echo "Python 3.12.1"; exit 0; fi\nprintf 'numpy\\t2.1.0\\n'\n`
    );
    await writeFile(join(bin, "node"), "#!/bin/bash\necho v22.0.0\n");
    await chmod(join(bin, "python3"), 0o755);
    await chmod(join(bin, "node"), 0o755);

    return `${bin}:/usr/bin:/bin`;
  }

  const probed = [
    {
      command: "python3",
      version: "Python 3.12.1",
      packages: { numpy: "2.1.0" },
    },
    { command: "node", version: "v22.0.0", packages: {} },
  ];

  posix(
    "probe names the interpreters on the PATH with their versions, and the first Python's packages",
    async () => {
      const path = await interpreters();

      const runtimes = await createStrategyRunner({
        runs: join(directory, "runs"),
        sandbox: undefined,
        sandboxed: () => false,
        path: async () => path,
      }).probe();

      // The system's own folders on the PATH may hold other interpreters.
      expect(
        runtimes.filter((each) => ["python3", "node"].includes(each.command))
      ).toEqual(probed);
      expect(await readdir(join(directory, "runs"))).toEqual([]);
    }
  );

  sandboxed(
    "probe finds in the sandbox only interpreters it finds outside it, each with its version",
    async () => {
      const box = createSandbox({
        home: join(directory, "home"),
        appFolders: [join(directory, "config")],
      });

      const probe = (sandboxed: boolean) =>
        createStrategyRunner({
          runs: join(directory, "runs"),
          sandbox: box,
          sandboxed: () => sandboxed,
          path: async () => process.env.PATH,
        }).probe();

      try {
        const outside = (await probe(false)).map((each) => each.command);
        const inside = await probe(true);

        for (const runtime of inside) {
          expect(outside).toContain(runtime.command);
          expect(runtime.version).toMatch(/\d+\.\d+/);
        }
      } finally {
        await box.close();
      }
    },
    30_000
  );
});
