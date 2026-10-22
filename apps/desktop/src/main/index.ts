import { join } from "node:path";

import { app, BrowserWindow, dialog, powerMonitor } from "electron";
import { kebabCase, withTimeout } from "es-toolkit";

import { errorMessage } from "@solyx/utils/error";

import { SettingsSection } from "#shared/settings-section.ts";
import { resolveLocale } from "#shared/settings.ts";
import { DestinationKind } from "#shared/workspace.ts";

import { RestoreFailure } from "./modules/backup/staged-restore.ts";
import { startCrashReports } from "./modules/crash-reports/crash-reports.ts";
import { CATALOGS, fill } from "./modules/settings/catalogs.ts";
import { createConfigFile } from "./modules/settings/config-file.ts";
import { serveRpc } from "./rpc/serve.ts";
import { createServices } from "./services.ts";
import type { Services } from "./services.ts";
import { appChannel } from "./shell/app-channel.ts";
import { APP_ICON, createMainWindow } from "./shell/main-window.ts";
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
const config = createConfigFile(
  join(app.getPath("home"), `.${kebabCase(app.getName())}`, "config.json")
);

// Before the app is ready, so a failure while it starts is caught too; nothing is sent until the
// user agrees.
startCrashReports(() => config.read().crashReports.send);

// Long enough for runs to store where they stopped, short enough never to hold up quitting.
const CLOSE_TIMEOUT_MS = 3000;

let quitting = false;

/**
 * The services, or nothing once a restored backup could not be put in place: the app then says
 * so and exits rather than start on half of each, and tries again the next time it starts.
 */
function startServices(): Services | undefined {
  try {
    return createServices(config);
  } catch (error) {
    if (!(error instanceof RestoreFailure)) throw error;

    const copy =
      CATALOGS[
        resolveLocale(config.read().appearance.language, app.getLocale())
      ].settings.backup["restore-stuck"];

    dialog.showErrorBox(
      copy.title,
      fill(copy.body, {
        reason: errorMessage(error.cause),
        folder: error.folder,
      })
    );
    app.exit(1);

    return undefined;
  }
}

void app.whenReady().then(() => {
  if (!alone) return;

  // Unpackaged runs launch Electron's own app bundle, whose icon the Dock would show.
  if (!app.isPackaged) app.dock?.setIcon(APP_ICON);

  const services = startServices();

  if (!services) return;

  serveRpc(services);
  createMainWindow(services.windowColors);
  void services.tray.sync();

  // The window opens where the restore was asked for, which says what became of it.
  if (services.restored) {
    services.workspace.open({
      kind: DestinationKind.Settings,
      section: SettingsSection.Backup,
    });
  }

  // The Dock follows whether a window is open.
  app.on("browser-window-created", () => void services.tray.sync());

  app.on("second-instance", () => services.workspace.open());

  // Runs the last session left unfinished continue where they stopped. A store that cannot open
  // fails every agent call too, which the renderer shows.
  services.agent
    .resume()
    .catch((error) =>
      services.telemetry.diagnostics.report(error, "agent.resume")
    );

  services.scheduler.start();

  // Timers sleep with the computer, so what came due meanwhile starts as it wakes.
  powerMonitor.on("resume", services.scheduler.tick);

  // Runs still going are stored where they stopped and continue at the next start, and stdio MCP
  // servers are shut down rather than left running without the app.
  app.on("before-quit", (event) => {
    if (quitting) return;

    quitting = true;
    event.preventDefault();
    services.scheduler.stop();
    services.tray.close();

    // Traces last, so they hold how the runs stopped.
    void withTimeout(async () => {
      await services.agent.close();
      await services.telemetry.close();
    }, CLOSE_TIMEOUT_MS)
      .catch((error) =>
        services.telemetry.diagnostics.report(error, "app.close")
      )
      .finally(() => app.quit());
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0)
      createMainWindow(services.windowColors);
  });

  // The app goes on in the tray, or in the Dock as a macOS app does. A quit that a signal such as
  // SIGTERM started closes the windows but stops there once before-quit has deferred it, so
  // closing the last window finishes it.
  app.on("window-all-closed", () => {
    if (quitting || !services.tray.staysOpen()) app.quit();
    else void services.tray.sync();
  });
});
