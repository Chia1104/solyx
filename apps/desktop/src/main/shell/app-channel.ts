import { app } from "electron";

import { AppChannel } from "#shared/app-channel.ts";

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
