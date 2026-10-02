import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { once } from "es-toolkit";

const execFileAsync = promisify(execFile);

// Brackets the value, since interactive shells may print banners around it.
const MARK = "__SOLYX_PATH__";

async function read(): Promise<string | undefined> {
  if (process.platform === "win32") return process.env.PATH;

  try {
    const { stdout } = await execFileAsync(
      process.env.SHELL || "/bin/zsh",
      ["-ilc", `printf '${MARK}%s${MARK}' "$PATH"`],
      { timeout: 5000 }
    );

    return stdout.split(MARK)[1] || process.env.PATH;
  } catch {
    return process.env.PATH;
  }
}

/**
 * The PATH the user's login shell sets up, read once. An app opened from the Dock on macOS starts
 * with a bare PATH, where stdio MCP servers launched through `npx` or `uvx` would not be found.
 */
export function loginShellPath(): () => Promise<string | undefined> {
  return once(read);
}
