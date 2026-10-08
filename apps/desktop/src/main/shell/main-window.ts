import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserWindow, nativeTheme, shell } from "electron";

import type { PaletteColors } from "#shared/palette.ts";

import { PRODUCT_NAME } from "../product.ts";

// Main is bundled into dist/main, next to dist/preload and dist/renderer.
const bundleDir = fileURLToPath(new URL(".", import.meta.url));

const rendererUrl = process.env.SOLYX_RENDERER_URL;

/** The dark rendition of `resources/icon.icon`, which is the icon's source. */
export const APP_ICON = join(bundleDir, "icon.png");

/** The renderer's title bar height; it lays itself out around the controls through `env(titlebar-area-*)`. */
const TITLE_BAR_HEIGHT = 44;

function titleBarOverlay(colors: PaletteColors) {
  return {
    color: colors.background,
    symbolColor: colors.foreground,
    height: TITLE_BAR_HEIGHT,
  };
}

/**
 * Paints the window's own background, which shows until the page paints, and the window
 * controls Windows and Linux draw.
 */
export function paintWindow(win: BrowserWindow, colors: PaletteColors) {
  win.setBackgroundColor(colors.background);

  if (process.platform !== "darwin")
    win.setTitleBarOverlay(titleBarOverlay(colors));
}

/**
 * The renderer is sandboxed and can only reach the main process through the preload bridge.
 * `colors` gives the palette the window shows at the moment.
 */
export function createMainWindow(colors: () => PaletteColors) {
  const initial = colors();

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    // Room for the watchlist, a readable chart and the agent pane side by side.
    minWidth: 1024,
    minHeight: 640,
    title: PRODUCT_NAME,
    // Windows shows the executable's icon and macOS the app's.
    icon: process.platform === "linux" ? APP_ICON : undefined,
    backgroundColor: initial.background,
    titleBarStyle: "hidden",
    titleBarOverlay: titleBarOverlay(initial),
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
  const followTheme = () => paintWindow(win, colors());

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

  if (rendererUrl) {
    void win.loadURL(rendererUrl);
    // Detached, since docked it would squeeze the workspace's panes.
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(join(bundleDir, "../renderer/index.html"));
  }

  return win;
}
