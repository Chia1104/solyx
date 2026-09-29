import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, shell } from "electron";

import { registerIpc } from "./ipc.ts";
import { createServices } from "./services.ts";

const bundleDir = fileURLToPath(new URL(".", import.meta.url));

const rendererUrl = process.env.SOLYX_RENDERER_URL;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Solyx",
    webPreferences: {
      preload: join(bundleDir, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // External links go to the system browser; the window itself never leaves the app UI.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);

    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => {
    if (!rendererUrl || !event.url.startsWith(rendererUrl))
      event.preventDefault();
  });

  if (rendererUrl) void win.loadURL(rendererUrl);
  else void win.loadFile(join(bundleDir, "../renderer/index.html"));
}

void app.whenReady().then(() => {
  registerIpc(createServices());
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
