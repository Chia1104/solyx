import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserWindow, nativeTheme, shell } from "electron";

// Main is bundled into dist/main, next to dist/preload and dist/renderer.
const bundleDir = fileURLToPath(new URL(".", import.meta.url));

const rendererUrl = process.env.SOLYX_RENDERER_URL;

/** The renderer's title bar height; it lays itself out around the controls through `env(titlebar-area-*)`. */
const TITLE_BAR_HEIGHT = 44;

// Mirrors --background and --foreground in the renderer's styles.css: the window shows the
// background until the page paints, and Windows and Linux draw their window controls in both.
const PALETTE = {
  light: { background: "#f3f5f8", foreground: "#23272f" },
  dark: { background: "#0f141c", foreground: "#e4e8ef" },
};

function currentPalette() {
  return nativeTheme.shouldUseDarkColors ? PALETTE.dark : PALETTE.light;
}

function titleBarOverlay() {
  const palette = currentPalette();

  return {
    color: palette.background,
    symbolColor: palette.foreground,
    height: TITLE_BAR_HEIGHT,
  };
}

/** The renderer is sandboxed and can only reach the main process through the preload bridge. */
export function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    // Room for the watchlist, a readable chart and the agent pane side by side.
    minWidth: 1024,
    minHeight: 640,
    title: "Solyx",
    backgroundColor: currentPalette().background,
    titleBarStyle: "hidden",
    titleBarOverlay: titleBarOverlay(),
    // Centers the traffic lights in the title bar.
    trafficLightPosition: { x: 14, y: 15 },
    webPreferences: {
      preload: join(bundleDir, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // The theme can change from settings as well as from the OS.
  const followTheme = () => {
    win.setBackgroundColor(currentPalette().background);

    if (process.platform !== "darwin")
      win.setTitleBarOverlay(titleBarOverlay());
  };

  nativeTheme.on("updated", followTheme);
  win.on("closed", () => nativeTheme.off("updated", followTheme));

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
