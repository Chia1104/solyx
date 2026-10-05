// What a process the agent starts takes from the app's environment, as other MCP clients pass it:
// enough to find its home, user and shell. Anything else, such as keys a terminal exported, stays
// out.
const INHERITED_ENV =
  process.platform === "win32"
    ? [
        "APPDATA",
        "HOMEDRIVE",
        "HOMEPATH",
        "LOCALAPPDATA",
        "PATH",
        "PROCESSOR_ARCHITECTURE",
        "PROGRAMFILES",
        "SYSTEMDRIVE",
        "SYSTEMROOT",
        "TEMP",
        "USERNAME",
        "USERPROFILE",
      ]
    : ["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER"];

/** The part of the app's environment a stdio MCP server or a shell command starts with. */
export function inheritedEnv(): Record<string, string> {
  return Object.fromEntries(
    INHERITED_ENV.flatMap((name) => {
      const value = process.env[name];

      return value === undefined ? [] : [[name, value]];
    })
  );
}
