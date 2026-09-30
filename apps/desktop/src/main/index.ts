import { join } from "node:path";

import { app, BrowserWindow } from "electron";
import { delay } from "es-toolkit";

import { registerIpc } from "./ipc/register-ipc.ts";
import { createServices } from "./services.ts";
import { createMainWindow } from "./shell/main-window.ts";

// The name picks userData and the OS secret store entry, so development never reads or
// changes what an installed Solyx keeps, such as broker credentials. It must change before ready.
if (!app.isPackaged) {
  app.setName(`${app.getName()} Dev`);
  app.setPath("userData", join(app.getPath("appData"), app.getName()));
}

// Long enough for providers to acknowledge an abort, short enough never to hold up quitting.
const STOP_RUNS_TIMEOUT_MS = 3000;

let quitting = false;

void app.whenReady().then(() => {
  const services = createServices();

  registerIpc(services);
  createMainWindow();

  // Stopped runs keep what they streamed and end as aborted instead of cut off mid-message, and
  // stdio MCP servers are shut down rather than left running without the app.
  app.on("before-quit", (event) => {
    if (quitting) return;

    quitting = true;
    event.preventDefault();

    void Promise.race([
      services.agent.close(),
      delay(STOP_RUNS_TIMEOUT_MS),
    ]).finally(() => app.quit());
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

// A quit that a signal such as SIGTERM started closes the windows but stops there once
// before-quit has deferred it, so closing the last window finishes it.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || quitting) app.quit();
});
