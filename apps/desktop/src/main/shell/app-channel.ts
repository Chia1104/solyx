import { app } from "electron";

/** Which build of the app runs: a development run, or the channel a packaged build was made for. */
export const AppChannel = {
  Development: "development",
  Nightly: "nightly",
  Stable: "stable",
  Test: "test",
} as const;

export type AppChannel = (typeof AppChannel)[keyof typeof AppChannel];

/**
 * A packaged build's version names its channel: the release workflow writes a nightly's, and the
 * test package's config its own.
 */
export function appChannel(): AppChannel {
  if (!app.isPackaged) return AppChannel.Development;

  const version = app.getVersion();

  if (version.includes("-nightly.")) return AppChannel.Nightly;

  return version.endsWith("-test") ? AppChannel.Test : AppChannel.Stable;
}
