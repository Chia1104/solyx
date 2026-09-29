import { join } from "node:path";

import { app, BrowserWindow } from "electron";

import { registerIpc } from "./ipc/register-ipc.ts";
import { createServices } from "./services.ts";
import { createMainWindow } from "./shell/main-window.ts";

// The name picks userData and the OS secret store entry, so development never reads or
// changes what an installed Solyx keeps, such as broker credentials. It must change before ready.
if (!app.isPackaged) {
  app.setName(`${app.getName()} Dev`);
  app.setPath("userData", join(app.getPath("appData"), app.getName()));
}

void app.whenReady().then(() => {
  registerIpc(createServices());
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
