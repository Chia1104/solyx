import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { inheritedEnv } from "@solyx/agent/process-env";
import type { Sandbox } from "@solyx/agent/sandbox";
import { POWERSHELL } from "@solyx/agent/shell";
import type { StrategyLines } from "@solyx/core/backtest";
import { readStrategyOutput } from "@solyx/core/strategy";
import type { StrategyInput, StrategyRuntime } from "@solyx/core/strategy";
import { isErrnoError } from "@solyx/utils/error";

import type { Strategy } from "./strategy-folder.ts";

/** How long a strategy's code has for one run, every job of it together. */
const STRATEGY_TIMEOUT_MS = 120_000;

/** The most a strategy's code may write, every job's lines together. */
const MAX_OUTPUT_BYTES = 128 * 1024 * 1024;

// What a run that failed keeps of what its code printed, the end of it, for the reason it gives.
const KEPT_PRINT = 4000;

const WINDOWS = process.platform === "win32";

export interface StrategyRunnerOptions {
  /** Where each run makes a folder of its own for its input and output, and its HOME in the sandbox. */
  runs: string;
  /** The app's one sandbox, `undefined` where the system has none. */
  sandbox: Sandbox | undefined;
  /** Whether the user keeps code sandboxed, read for every run where the system can. */
  sandboxed(): boolean;
  /** The PATH code starts with, since apps opened from the Dock do not get the shell's. */
  path(): Promise<string | undefined>;
  /** @default STRATEGY_TIMEOUT_MS */
  timeoutMs?: number;
}

/** Ends `child` and everything it started. */
function end(child: ChildProcess) {
  if (child.pid === undefined) return;

  if (WINDOWS) {
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {
      // One already gone has nothing left to end.
    });

    return;
  }

  try {
    // Started as the leader of its own group, so the group ends with it.
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // One already gone has nothing left to end.
  }
}

const printedTail = (printed: string) =>
  printed.trim() ? `; it printed:\n${printed.trim()}` : "";

/**
 * Runs `command` in `cwd` until it ends, with the end of what it printed, failing once it exits
 * other than with 0, runs past `timeoutMs` or `signal` stops it, each with that end too.
 */
function execute(
  command: string,
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
  signal: AbortSignal | undefined
) {
  return new Promise<string>((resolve, reject) => {
    const child = WINDOWS
      ? spawn(
          POWERSHELL,
          ["-NoProfile", "-NonInteractive", "-Command", command],
          { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
        )
      : spawn("/bin/bash", ["-c", command], {
          cwd,
          env,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        });

    let printed = "";
    let stopped: string | undefined;

    const keep = (chunk: Buffer) => {
      printed = (printed + chunk.toString()).slice(-KEPT_PRINT);
    };

    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);

    const stop = (why: string) => {
      stopped ??= why;
      end(child);
    };

    const timer = setTimeout(
      () => stop(`ran past ${timeoutMs / 1000} seconds`),
      timeoutMs
    );

    const abort = () => stop("was stopped");

    signal?.addEventListener("abort", abort, { once: true });

    const settle = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };

    child.on("error", (error) => {
      settle();
      reject(new Error(`The strategy's code did not start: ${error.message}`));
    });

    child.on("close", (code, killed) => {
      settle();

      if (stopped) {
        reject(
          new Error(`The strategy's code ${stopped}${printedTail(printed)}`)
        );
      } else if (code === 0) {
        resolve(printed);
      } else {
        reject(
          new Error(
            `The strategy's code exited with ${code ?? killed}${printedTail(printed)}`
          )
        );
      }
    });
  });
}

// What the probe looks for: the interpreters strategies are written for most, by their commands.
// On Windows Python is `python`, and `python3` is often the Store's stand-in.
const PROBED = WINDOWS
  ? ["python", "python3", "node", "deno", "bun", "uv", "Rscript"]
  : ["python3", "node", "deno", "bun", "uv", "Rscript"];

// The packages of Python's the probe asks for, by the names they are installed under.
const PYTHON_PACKAGES = ["numpy", "pandas", "polars", "scipy", "TA-Lib"];

/** How long one interpreter has to say its version, past which it counts as missing. */
const PROBE_TIMEOUT_MS = 10_000;

const PYTHON_PROBE = `import importlib.metadata as metadata

for name in ${JSON.stringify(PYTHON_PACKAGES)}:
    try:
        print(name + "\\t" + metadata.version(name))
    except Exception:
        pass
`;

/**
 * Prints `tool`'s version, failing where it is not on the PATH. macOS's own python3 asks to install
 * Apple's developer tools when they are missing, and Windows' python and python3 under WindowsApps
 * open the Microsoft Store, so neither counts.
 */
const versionCommand = (tool: string) =>
  WINDOWS
    ? `$found = Get-Command ${tool} -CommandType Application -ErrorAction Stop | Select-Object -First 1; if ($found.Source -like '*\\WindowsApps\\*') { exit 1 }; & $found.Source --version`
    : tool === "python3"
      ? `where=$(command -v python3) && { [ "$where" != /usr/bin/python3 ] || [ "$(uname)" != Darwin ] || xcode-select -p >/dev/null 2>&1; } && python3 --version`
      : `command -v ${tool} >/dev/null && ${tool} --version`;

/**
 * The line of `printed` that gives a version, `undefined` where none does. macOS's own python3
 * prints xcrun's complaints about its cache ahead of it in the sandbox, which it may not write.
 */
const versionLine = (printed: string) =>
  printed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /\d+\.\d+/.test(line) && !/\berror\b/i.test(line));

/** Each `name<TAB>version` line `printed` holds. */
const versionsOf = (printed: string) =>
  Object.fromEntries(
    printed
      .split(/\r?\n/)
      .map((line) => line.split("\t"))
      .filter((parts) => parts.length === 2)
      .map(([name, version]) => [name, version.trim()])
  );

/**
 * Runs strategies' code, each run on a copy of its strategy's files in a folder of its own, with
 * the environment a shell command gets and where its input and output go, in the sandbox while the
 * user keeps it on: there it reads and writes only its run's folder, reads the tools on its PATH,
 * and reaches no network.
 */
export function createStrategyRunner(options: StrategyRunnerOptions) {
  const timeoutMs = options.timeoutMs ?? STRATEGY_TIMEOUT_MS;

  /** `work` in a folder of its own under `runs`, erased once it ends. */
  async function inFolder<T>(
    prefix: string,
    work: (folder: string) => Promise<T>
  ) {
    await mkdir(options.runs, { recursive: true });

    const folder = await mkdtemp(join(options.runs, `${prefix}-`));

    try {
      return await work(folder);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  /**
   * Runs `command` from `cwd` with the environment a shell command gets and `own`, in the sandbox
   * while the user keeps it on, where `folder` is its HOME and the one place it writes.
   */
  async function start(
    folder: string,
    cwd: string,
    command: string,
    own: Record<string, string>,
    timeout: number,
    signal: AbortSignal | undefined
  ) {
    const tmp = join(folder, ".tmp");

    await mkdir(tmp, { recursive: true });

    const path = await options.path();
    const sandbox = options.sandboxed() ? options.sandbox : undefined;

    const env = {
      ...inheritedEnv(),
      ...(path && { PATH: path }),
      // Tools read and keep their settings in HOME, which the sandbox hides.
      ...(sandbox && { HOME: folder, TMPDIR: tmp }),
      ...own,
    };

    const wrapped = sandbox
      ? await sandbox.wrap(
          command,
          { workspace: folder, tmp, readable: [], path },
          signal
        )
      : command;

    return execute(wrapped, cwd, env, timeout, signal);
  }

  return {
    /** Each of `input`'s jobs' lines as `strategy`'s code works them out, in the jobs' order. */
    run: (
      strategy: Strategy,
      input: StrategyInput,
      signal?: AbortSignal
    ): Promise<StrategyLines[]> =>
      inFolder(strategy.manifest.name, async (folder) => {
        const code = join(folder, "code");
        const inputFile = join(folder, "input.json");
        const outputFile = join(folder, "output.json");

        // The copy holds the very bytes its version was told from, so what runs is what was allowed.
        for (const file of strategy.code) {
          const place = join(code, ...file.path.split("/"));

          await mkdir(dirname(place), { recursive: true });
          await writeFile(place, file.data);
        }

        await writeFile(inputFile, JSON.stringify(input));

        await start(
          folder,
          code,
          strategy.manifest.run,
          {
            SOLYX_STRATEGY_INPUT: inputFile,
            SOLYX_STRATEGY_OUTPUT: outputFile,
          },
          timeoutMs,
          signal
        );

        let bytes: number;

        try {
          bytes = (await stat(outputFile)).size;
        } catch (error) {
          if (!isErrnoError(error, "ENOENT")) throw error;

          throw new Error(
            "The strategy's code ended without writing its lines to the file $SOLYX_STRATEGY_OUTPUT names",
            { cause: error }
          );
        }

        if (bytes > MAX_OUTPUT_BYTES) {
          throw new Error(
            `The strategy's code wrote ${Math.round(bytes / 1024 / 1024)} MB of lines, more than the ${MAX_OUTPUT_BYTES / 1024 / 1024} MB a run reads`
          );
        }

        return readStrategyOutput(await readFile(outputFile, "utf8"), input);
      }),

    /**
     * The interpreters a strategy's code finds on its PATH where it would run now, each with its
     * version, and the packages strategies use most that the first Python among them has. Each is
     * asked on its own, so one that does not answer counts as missing and holds up no other.
     */
    probe: (signal?: AbortSignal) =>
      inFolder("probe", async (folder) => {
        const ask = async (command: string) => {
          try {
            return await start(
              folder,
              folder,
              command,
              {},
              PROBE_TIMEOUT_MS,
              signal
            );
          } catch {
            return undefined;
          }
        };

        await writeFile(join(folder, "probe.py"), PYTHON_PROBE);

        const found = await Promise.all(
          PROBED.map(async (command) => {
            const version = versionLine(
              (await ask(versionCommand(command))) ?? ""
            );

            return version ? { command, version } : undefined;
          })
        );

        const runtimes: StrategyRuntime[] = found
          .filter((runtime) => runtime !== undefined)
          .map((runtime) => ({ ...runtime, packages: {} }));

        const python = runtimes.find((runtime) =>
          runtime.command.startsWith("python")
        );

        if (python) {
          python.packages = versionsOf(
            (await ask(`${python.command} probe.py`)) ?? ""
          );
        }

        return runtimes;
      }),
  };
}

export type StrategyRunner = ReturnType<typeof createStrategyRunner>;
