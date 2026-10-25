import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
} from "node:path";
import { promisify } from "node:util";

import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { once } from "es-toolkit";

const MAC = process.platform === "darwin";

/**
 * Whether this system can sandbox shell commands: macOS through Seatbelt, Linux through bubblewrap
 * and seccomp. sandbox-runtime's Windows sandbox needs an install as administrator, so there is none.
 */
export const SANDBOX_SUPPORTED = MAC || process.platform === "linux";

// sandbox-runtime keeps this folder writable as every embedder's temporary folder, so another
// app's sandboxed commands, Claude Code's among them, leave files there.
const SHARED_TEMP = MAC
  ? ["/tmp/claude", "/private/tmp/claude"]
  : ["/tmp/claude"];

export interface SandboxOptions {
  /** The user's home, which a command reads only where its places say. */
  home: string;
  /** The app's own folders, its data and settings, which no folder a command may read contains. */
  appFolders: readonly string[];
}

/** Where one command may go. */
interface SandboxPlaces {
  /** The folder it works in, the only one it may write. */
  workspace: string;
  /** Where its temporary files go, inside the workspace. */
  tmp: string;
  /** Folders it may read besides, such as the skills offered. */
  readable: readonly string[];
  /** The PATH it starts with, whose folders under the home stay readable. */
  path: string | undefined;
}

/** The home and the places no folder a command reads may open, as real paths. */
interface Bounds {
  home: string;
  closed: string[];
}

const literal = (path: string) => ({ path, literal: true as const });

const within = (folder: string, path: string) => {
  const rest = relative(folder, path);

  return rest === "" || (!rest.startsWith("..") && !isAbsolute(rest));
};

/** A folder a command reads lifts the denials beneath it, so it must hold neither the home nor a closed place. */
const opens = (folder: string, bounds: Bounds) =>
  folder === bounds.home ||
  bounds.closed.some((place) => within(folder, place));

const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

// Folders are compared as real paths, since a link may lead under a place by another spelling.
const real = (path: string) => realpath(path).catch(() => path);

const execFileAsync = promisify(execFile);

/**
 * Places beside the home no command reads: on macOS the folder every app keeps its temporary files
 * and caches in for this user (TMPDIR's parent) and mounted volumes; on Linux the user's runtime
 * folder, which holds the session bus and keyring sockets, and mounted media.
 */
async function systemDenials(): Promise<string[]> {
  if (MAC) {
    const { stdout } = await execFileAsync("getconf", ["DARWIN_USER_TEMP_DIR"]);

    return [dirname(stdout.trim()), "/Volumes"];
  }

  return [
    process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.()}`,
    "/media",
    "/mnt",
    "/run/media",
  ];
}

/** Where the system keeps the user's secrets, which no folder a command may read opens. */
const secretStores = (home: string) =>
  MAC
    ? [join(home, "Library", "Keychains")]
    : [
        join(home, ".local", "share", "keyrings"),
        join(home, ".local", "share", "kwalletd"),
      ];

// sandbox-runtime's own warning: without its seccomp filter a command may open Unix sockets, the
// session bus among them, through which the keyring hands out the app's key.
const NO_SECCOMP = "seccomp not available";

/**
 * What keeps the sandbox from starting on this system, such as bubblewrap missing on Linux or a
 * system that forbids it user namespaces; empty when it can start.
 */
export async function sandboxProblems(): Promise<string[]> {
  if (!SANDBOX_SUPPORTED) return ["this system has no sandbox"];

  const { errors, warnings } = SandboxManager.checkDependencies();

  const problems = [
    ...errors,
    ...warnings.filter((warning) => warning.startsWith(NO_SECCOMP)),
  ];

  if (MAC || problems.length > 0) return problems;

  // Ubuntu's AppArmor, among others, can forbid the user namespace bubblewrap needs.
  try {
    await execFileAsync("bwrap", [
      "--ro-bind",
      "/",
      "/",
      "--unshare-user",
      "--unshare-net",
      "true",
    ]);
  } catch (error) {
    const said =
      error instanceof Error && "stderr" in error ? error.stderr : error;

    problems.push(`bubblewrap cannot start: ${String(said).trim()}`);
  }

  return problems;
}

/**
 * The folders under the home that hold the commands on `path`: each such folder on it, and where
 * each command in it that is a link leads, from the top of a `bin` folder so a tool finds its
 * libraries. A folder that opens the bounds or lies in a closed place is left out.
 */
async function toolFolders(
  path: string | undefined,
  bounds: Bounds
): Promise<string[]> {
  const folders = new Set<string>();

  const add = (folder: string) => {
    if (
      within(bounds.home, folder) &&
      !opens(folder, bounds) &&
      !bounds.closed.some((place) => within(place, folder))
    )
      folders.add(folder);
  };

  const onPath = (path ?? "").split(delimiter).filter(isAbsolute);

  await Promise.all(
    onPath.map(async (entry) => {
      const folder = await real(entry);

      if (!within(bounds.home, folder)) return;

      add(folder);

      const names = await readdir(folder).catch(() => []);

      await Promise.all(
        names.map(async (name) => {
          const file = join(folder, name);

          if (!(await lstat(file).catch(() => undefined))?.isSymbolicLink())
            return;

          const target = await realpath(file).catch(() => undefined);

          if (target === undefined) return;

          const parent = dirname(target);

          add(basename(parent) === "bin" ? dirname(parent) : parent);
        })
      );
    })
  );

  return [...folders];
}

/**
 * Wraps a shell command in sandbox-runtime's profile, Seatbelt's on macOS and bubblewrap's on
 * Linux: it writes only in its workspace, which is also where its temporary files go, reads nothing
 * of the home, the app's folders and `systemDenials` but the folders its places name, and reaches no
 * network, this computer's included, since sandbox-runtime's proxies refuse every host.
 */
export function createSandbox(options: SandboxOptions) {
  const { home, appFolders } = options;

  // A folder a command reads may sit under the home, but must never open these.
  const closed = [...appFolders, ...secretStores(home)];

  const policy = (
    places: SandboxPlaces,
    denials: readonly string[],
    readable: readonly string[]
  ): SandboxRuntimeConfig => ({
    network: { allowedDomains: [], deniedDomains: [] },
    filesystem: {
      denyRead: [home, ...denials, ...appFolders, ...SHARED_TEMP]
        .filter(existsSync)
        .map(literal),
      allowRead: [places.workspace, ...readable].map(literal),
      allowWrite: [literal(places.workspace)],
      denyWrite: SHARED_TEMP.filter(existsSync).map(literal),
    },
  });

  let started = false;

  // Starts the proxies every command's network goes through, which refuse every host. Every
  // command brings its own policy, so the one it starts with lets nothing be written.
  const start = once(async () => {
    started = true;
    await SandboxManager.initialize({
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: { denyRead: [literal(home)], allowWrite: [], denyWrite: [] },
    });

    return systemDenials();
  });

  // Once the sandbox has started, what it needs stays in place for the life of the app.
  let ready = false;

  return {
    /** `command` as it runs in the sandbox. */
    async wrap(
      command: string,
      places: SandboxPlaces,
      signal: AbortSignal | undefined
    ): Promise<string> {
      if (!ready) {
        const problems = await sandboxProblems();

        if (problems.length > 0)
          throw new Error(
            `The sandbox cannot start (${problems.join("; ")}), so the command did not run. Ask the user to fix that, or to switch the sandbox off in Settings → Skills.`
          );

        ready = true;
      }

      const denials = await start();

      const [realHome, ...realClosed] = await Promise.all(
        [home, ...closed].map(real)
      );

      const bounds = { home: realHome, closed: realClosed };

      // A skill's folder may be a link the user made, so it is held to the bounds as a tool's is.
      const skills = await Promise.all(places.readable.map(real));

      return SandboxManager.wrapWithSandbox(
        // sandbox-runtime points TMPDIR at the shared folder, so the command points it back.
        `export TMPDIR=${quote(places.tmp)}\n${command}`,
        undefined,
        policy(places, denials, [
          ...skills.filter((folder) => !opens(folder, bounds)),
          ...(await toolFolders(places.path, bounds)),
        ]),
        signal
      );
    },

    /** Stops the proxies, as the app quits. */
    async close() {
      if (started) await SandboxManager.reset();
    },
  };
}
