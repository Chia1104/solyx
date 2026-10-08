import { join } from "node:path";

import { app, BrowserWindow, powerMonitor } from "electron";
import { withTimeout } from "es-toolkit";

import { registerIpc } from "./ipc/register-ipc.ts";
import { createServices } from "./services.ts";
import { APP_ICON, createMainWindow } from "./shell/main-window.ts";

// The name picks userData and the OS secret store entry, so development never reads or
// changes what an installed Solyx keeps, such as broker credentials. It must change before ready.
if (!app.isPackaged) {
  app.setName(`${app.getName()} Dev`);
  app.setPath("userData", join(app.getPath("appData"), app.getName()));
}

// Long enough for runs to store where they stopped, short enough never to hold up quitting.
const CLOSE_TIMEOUT_MS = 3000;

let quitting = false;

void app.whenReady().then(() => {
  // Unpackaged runs launch Electron's own app bundle, whose icon the Dock would show.
  if (!app.isPackaged) app.dock?.setIcon(APP_ICON);

  const services = createServices();

  registerIpc(services);
  createMainWindow(services.windowColors);

  // Runs the last session left unfinished continue where they stopped. A store that cannot open
  // fails every agent call too, which the renderer shows.
  services.agent.resume().catch(console.error);

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

    void withTimeout(() => services.agent.close(), CLOSE_TIMEOUT_MS)
      .catch(console.error)
      .finally(() => app.quit());
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0)
      createMainWindow(services.windowColors);
  });
});

// A quit that a signal such as SIGTERM started closes the windows but stops there once
// before-quit has deferred it, so closing the last window finishes it.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || quitting) app.quit();
});
