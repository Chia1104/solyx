import { app, BrowserWindow } from "electron";

import { registerIpc } from "./ipc/register-ipc.ts";
import { createServices } from "./services.ts";
import { createMainWindow } from "./shell/main-window.ts";

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
