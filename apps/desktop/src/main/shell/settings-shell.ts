import { BrowserWindow, app, dialog, shell } from "electron";
import type { OpenDialogOptions } from "electron";

import { FubonFile } from "#shared/settings.ts";

import { canReportCrashes } from "../modules/crash-reports/crash-reports.ts";
import type { SettingsShell } from "../modules/settings/settings.route.ts";

// People know these by name rather than by Node's platform ids.
const OS_NAME: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

const FUBON_FILE_DIALOG: Record<FubonFile, OpenDialogOptions> = {
  [FubonFile.Sdk]: { properties: ["openDirectory"] },
  [FubonFile.Certificate]: {
    properties: ["openFile"],
    filters: [{ name: "PKCS #12", extensions: ["pfx", "p12"] }],
  },
};

export const settingsShell: SettingsShell = {
  async chooseFubonFile(file, sender) {
    const window = BrowserWindow.fromWebContents(sender);
    const options = FUBON_FILE_DIALOG[file];

    const { canceled, filePaths } = await (window
      ? dialog.showOpenDialog(window, options)
      : dialog.showOpenDialog(options));

    const [path] = filePaths;

    return canceled || path === undefined ? null : path;
  },

  showItemInFolder: (path) => shell.showItemInFolder(path),

  about: () => ({
    name: app.getName(),
    version: app.getVersion(),
    packaged: app.isPackaged,
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    os: `${OS_NAME[process.platform] ?? process.platform} ${process.getSystemVersion()} (${process.arch})`,
  }),

  canReportCrashes,

  hasDock: process.platform === "darwin",
};
