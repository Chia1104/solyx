import { app } from "electron";

/** Which build of the app runs: a development run, or the channel a packaged build was released on. */
export const AppChannel = {
  Development: "development",
  Nightly: "nightly",
  Stable: "stable",
} as const;

export type AppChannel = (typeof AppChannel)[keyof typeof AppChannel];

/** A nightly's version names its channel, as the release workflow writes it. */
export function appChannel(): AppChannel {
  if (!app.isPackaged) return AppChannel.Development;

  return app.getVersion().includes("-nightly.")
    ? AppChannel.Nightly
    : AppChannel.Stable;
}
