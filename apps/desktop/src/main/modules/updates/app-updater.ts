import { app } from "electron";
import { autoUpdater } from "electron-updater";

import type { Updater } from "./updates.ts";

/**
 * electron-updater on the feed electron-builder wrote into the app (`app-update.yml`). Only Windows
 * installs updates: macOS would install them through Squirrel.Mac, which needs a Developer ID
 * signature, so there the feed only says which version is newer.
 */
export function createAppUpdater(): Updater | null {
  if (
    !app.isPackaged ||
    (process.platform !== "win32" && process.platform !== "darwin")
  )
    return null;

  const installs = process.platform === "win32";

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = installs;

  return {
    installs,

    async check() {
      const result = await autoUpdater.checkForUpdates();

      return result?.isUpdateAvailable ? result.updateInfo.version : null;
    },

    async download() {
      await autoUpdater.downloadUpdate();
    },

    install: () => autoUpdater.quitAndInstall(),
  };
}
