import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserWindow, shell } from "electron";

// Main is bundled into dist/main, next to dist/preload and dist/renderer.
const bundleDir = fileURLToPath(new URL(".", import.meta.url));

const rendererUrl = process.env.SOLYX_RENDERER_URL;

/** The renderer is sandboxed and can only reach the main process through the preload bridge. */
export function createMainWindow() {
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

  return win;
}
