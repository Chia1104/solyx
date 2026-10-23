import { app, shell } from "electron";

import type { Host } from "../host.ts";

import { appChannel } from "./app-channel.ts";
import { createAppUpdater } from "./app-updater.ts";
import { chromiumFetch } from "./chromium-fetch.ts";
import { reportError } from "./crash-reports.ts";
import { electronCipher } from "./electron-cipher.ts";
import { openFubonProcess } from "./fubon-process.ts";
import type { Windows } from "./main-window.ts";
import { settingsShell } from "./settings-shell.ts";
import { createTrayShell } from "./tray-icon.ts";

/** The services' host in Electron's main process, around the app's windows; built once the app is ready. */
export function createElectronHost(windows: Windows): Host {
  const showWindow = () => windows.show();

  return {
    name: app.getName(),
    version: app.getVersion(),
    channel: appChannel(),
    locale: app.getLocale(),
    dataDir: app.getPath("userData"),
    homeDir: app.getPath("home"),
    cipher: electronCipher,
    updater: createAppUpdater(),
    reportError,
    chromiumFetch,
    openFubonProcess,
    openExternal: (url) => void shell.openExternal(url),
    showWindow,
    paintWindows: (paint) => windows.paint(paint),
    tray: createTrayShell(showWindow),
    settings: settingsShell,
    restart() {
      app.relaunch();
      app.quit();
    },
  };
}
