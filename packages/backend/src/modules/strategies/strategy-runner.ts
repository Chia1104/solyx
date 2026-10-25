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
import { join } from "node:path";

import { inheritedEnv } from "@solyx/agent/process-env";
import type { Sandbox } from "@solyx/agent/sandbox";
import { POWERSHELL } from "@solyx/agent/shell";
import type { StrategyLines } from "@solyx/core/backtest";
import { readStrategyOutput } from "@solyx/core/strategy";
import type { StrategyInput } from "@solyx/core/strategy";
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
 * Runs `command` in `cwd` until it ends, failing once it exits other than with 0, runs past
 * `timeoutMs` or `signal` stops it, each with the end of what it printed.
 */
function execute(
  command: string,
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
  signal: AbortSignal | undefined
) {
  return new Promise<void>((resolve, reject) => {
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
        resolve();
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

/**
 * Runs strategies' code, each run in its strategy's folder with the environment a shell command
 * gets and where its input and output go, in the sandbox while the user keeps it on: there it
 * writes only its run's folder, reads only its strategy's folder and the tools on its PATH, and
 * reaches no network.
 */
export function createStrategyRunner(options: StrategyRunnerOptions) {
  const timeoutMs = options.timeoutMs ?? STRATEGY_TIMEOUT_MS;

  return {
    /** Each of `input`'s jobs' lines as `strategy`'s code works them out, in the jobs' order. */
    async run(
      strategy: Strategy,
      input: StrategyInput,
      signal?: AbortSignal
    ): Promise<StrategyLines[]> {
      await mkdir(options.runs, { recursive: true });

      const folder = await mkdtemp(
        join(options.runs, `${strategy.manifest.name}-`)
      );

      try {
        const tmp = join(folder, ".tmp");
        const inputFile = join(folder, "input.json");
        const outputFile = join(folder, "output.json");

        await mkdir(tmp);
        await writeFile(inputFile, JSON.stringify(input));

        const path = await options.path();
        const sandbox = options.sandboxed() ? options.sandbox : undefined;

        const env = {
          ...inheritedEnv(),
          ...(path && { PATH: path }),
          // Tools read and keep their settings in HOME, which the sandbox hides.
          ...(sandbox && { HOME: folder, TMPDIR: tmp }),
          SOLYX_STRATEGY_INPUT: inputFile,
          SOLYX_STRATEGY_OUTPUT: outputFile,
        };

        const command = sandbox
          ? await sandbox.wrap(
              strategy.manifest.run,
              { workspace: folder, tmp, readable: [strategy.folder], path },
              signal
            )
          : strategy.manifest.run;

        await execute(command, strategy.folder, env, timeoutMs, signal);

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
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    },
  };
}

export type StrategyRunner = ReturnType<typeof createStrategyRunner>;
