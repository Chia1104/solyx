import { join } from "node:path";

import { flush } from "@sentry/electron/main";
import { app, BrowserWindow, dialog, ipcMain, powerMonitor } from "electron";
import { isNotNil, kebabCase, withTimeout } from "es-toolkit";

import { RPC_CONNECT } from "@solyx/api/rpc/connect";
import { resolveLocale } from "@solyx/api/settings";
import { CATALOGS, fill } from "@solyx/backend/modules/settings/catalogs";
import { createConfigFile } from "@solyx/backend/modules/settings/config-file";

import { keepCrashRecord } from "../utility/crash-log.ts";

import { appChannel } from "./shell/app-channel.ts";
import { startBackend } from "./shell/backend-process.ts";
import { reportError, startCrashReports } from "./shell/crash-reports.ts";
import { APP_ICON, createWindows } from "./shell/main-window.ts";
import { refusesRemoteDebugging } from "./shell/remote-debugging.ts";

// Before anything else runs, so a stable or nightly build never opens the DevTools protocol's port
// or pipe, which Chromium opens as the app gets ready.
if (refusesRemoteDebugging(appChannel(), app.commandLine)) process.exit(1);

// The name picks userData and the OS secret store entry, so development never reads or
// changes what an installed Solyx keeps, such as broker credentials. It must change before ready.
if (!app.isPackaged) {
  app.setName(`${app.getName()} Dev`);
  app.setPath("userData", join(app.getPath("appData"), app.getName()));
}

// A second instance would run the clock and the order desk again over the same files, so its
// launch brings the first one's window forward instead. The lock is the userData folder's, which
// the name above picks.
const alone = app.requestSingleInstanceLock();

if (!alone) app.quit();

// Settings a person edits live in a dotfolder named after the app, so each channel keeps its own.
// The backend writes it; the main process only reads it.
const config = createConfigFile(
  join(app.getPath("home"), `.${kebabCase(app.getName())}`, "config.json")
);

// Before the app is ready, so a failure while it starts is caught too; nothing is sent until the
// user agrees.
startCrashReports(() => config.read().crashReports.send);

// Long enough for runs to store where they stopped, short enough never to hold up quitting.
const CLOSE_TIMEOUT_MS = 3000;

// As long as Sentry itself waits for its reports as a process ends.
const REPORTS_TIMEOUT_MS = 2000;

let quitting = false;

/** Says in a dialog why the app cannot go on, once the reports so far are sent, and exits. */
async function stop(reason: { title: string; body: string }) {
  // The dialog holds the main process until it closes, and exiting drops what is not sent.
  await flush(REPORTS_TIMEOUT_MS);
  dialog.showErrorBox(reason.title, reason.body);
  app.exit(1);
}

void app.whenReady().then(async () => {
  if (!alone) return;

  // Unpackaged runs launch Electron's own app bundle, whose icon the Dock would show.
  if (!app.isPackaged) app.dock?.setIcon(APP_ICON);

  const windows = createWindows();
  const backend = startBackend(windows, config.file);

  // The backend ending while the app runs leaves the windows nothing to ask, so the app quits.
  backend.onExit((ending) => {
    if (quitting) return;

    const { record, file } = keepCrashRecord(app.getPath("userData"), {
      version: app.getVersion(),
      channel: appChannel(),
      system: `${process.platform} ${process.arch} ${process.getSystemVersion()}`,
      electron: process.versions.electron,
      ...ending,
    });

    reportError(
      new Error(
        `The backend exited with code ${ending.code} (${ending.reason ?? "clean"})`
      ),
      { event: "backend.exit" }
    );

    const copy =
      CATALOGS[
        resolveLocale(config.read().appearance.language, app.getLocale())
      ].app["backend-stopped"];

    const ended = [record.code, record.reason, record.error?.type]
      .filter(isNotNil)
      .join(" · ");

    void stop({
      title: copy.title,
      body: [
        copy.body,
        fill(copy.ended, { ending: ended }),
        file && fill(copy.record, { file }),
      ]
        .filter(isNotNil)
        .join("\n\n"),
    });
  });

  // A restored backup that could not be put in place stops the app rather than start on half
  // of each; the next start tries again.
  const refusal = await backend.started;

  if (refusal) {
    await stop(refusal);

    return;
  }

  // Each window posts one end of a channel, which the backend serves the router on as that window.
  ipcMain.on(RPC_CONNECT, (event) => {
    const [port] = event.ports;

    backend.connectWindow(event.sender.id, port);
  });

  // The tray reads whether a window is open, and the Dock follows it.
  const countWindows = () =>
    backend.send(
      "windows",
      backend.control.windows(
        BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed()).length
      )
    );

  app.on("browser-window-created", (_event, win) => {
    countWindows();
    win.once("closed", countWindows);
  });

  windows.open();

  app.on("second-instance", () => windows.show());

  // Timers sleep with the computer, so what came due meanwhile starts as it wakes.
  powerMonitor.on("resume", () => backend.send("wake", backend.control.wake()));

  app.on("before-quit", (event) => {
    if (quitting) return;

    quitting = true;
    event.preventDefault();

    void withTimeout(() => backend.control.close(), CLOSE_TIMEOUT_MS)
      .catch((error) => reportError(error, { event: "app.close" }))
      .finally(() => app.quit());
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.open();
  });

  // The app goes on in the tray, or in the Dock as a macOS app does. A quit that a signal such as
  // SIGTERM started closes the windows but stops there once before-quit has deferred it, so
  // closing the last window finishes it.
  app.on("window-all-closed", () => {
    if (quitting) {
      app.quit();

      return;
    }

    void backend.control.staysOpen().then(
      (staysOpen) => {
        if (!staysOpen) app.quit();
      },
      () => app.quit()
    );
  });
});
