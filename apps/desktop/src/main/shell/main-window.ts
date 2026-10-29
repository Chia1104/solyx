import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserWindow, app, nativeTheme, shell } from "electron";

import { ColorScheme } from "@solyx/api/palette";
import { PRODUCT_NAME } from "@solyx/api/product";
import type { WindowPaint } from "@solyx/backend/host";

// Main is bundled into dist/main, next to dist/preload and dist/renderer.
const bundleDir = fileURLToPath(new URL(".", import.meta.url));

const rendererUrl = process.env.SOLYX_RENDERER_URL;

/** The dark rendition of `resources/icon.icon`, which is the icon's source. */
export const APP_ICON = join(bundleDir, "icon.png");

/** The height of the renderer's top row, its columns' headers, which keep clear of the controls through `env(titlebar-area-*)`. */
const TITLE_BAR_HEIGHT = 44;

/** What a window draws itself: the ground the page lies on, and its controls' symbols. */
interface WindowChrome {
  background: string;
  symbols: string;
}

function titleBarOverlay(chrome: WindowChrome) {
  return {
    color: chrome.background,
    symbolColor: chrome.symbols,
    height: TITLE_BAR_HEIGHT,
  };
}

/**
 * Paints the window's own background, in the page's colour so it shows until the page paints,
 * and the window controls Windows and Linux draw on it.
 */
function paintWindow(win: BrowserWindow, chrome: WindowChrome) {
  win.setBackgroundColor(chrome.background);

  if (process.platform !== "darwin")
    win.setTitleBarOverlay(titleBarOverlay(chrome));
}

/** The app's windows, which show what the services last painted. */
export function createWindows() {
  let painted: WindowPaint | undefined;

  /** The chrome of the palette windows show now, in the scheme the theme or the computer picks. */
  function chrome(): WindowChrome {
    if (!painted)
      throw new Error("The services paint windows before one opens");

    const scheme = nativeTheme.shouldUseDarkColors
      ? ColorScheme.Dark
      : ColorScheme.Light;

    const colors = painted.colors[scheme];

    return { background: colors.background, symbols: colors.foreground };
  }

  /** The renderer is sandboxed and can only reach the main process through the preload bridge. */
  function open() {
    const initial = chrome();

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
    const followTheme = () => paintWindow(win, chrome());

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

    // Frames hold only the views the agent draws, which stay on the markup they were given.
    win.webContents.on("will-frame-navigate", (event) => {
      if (!event.isMainFrame && event.url !== "about:srcdoc")
        event.preventDefault();
    });

    if (rendererUrl) {
      void win.loadURL(rendererUrl);
      // Detached, since docked it would squeeze the workspace's panes.
      win.webContents.openDevTools({ mode: "detach" });
    } else {
      void win.loadFile(join(bundleDir, "../renderer/index.html"));
    }
  }

  return {
    open,

    /** Gives every window, and those opened later, the theme and palettes `paint` holds. */
    paint(paint: WindowPaint) {
      painted = paint;
      // Windows and their renderers' prefers-color-scheme follow it.
      nativeTheme.themeSource = paint.theme;

      for (const win of BrowserWindow.getAllWindows()) {
        paintWindow(win, chrome());
      }
    },

    /** Brings the app's window to the front, opening one when none is. */
    show() {
      const [win] = BrowserWindow.getAllWindows();

      if (win) {
        if (win.isMinimized()) win.restore();

        win.show();
        win.focus();
      } else {
        open();
      }

      // Asked for from the tray or by a second launch, the app is behind whatever the user was in.
      app.focus({ steal: true });
    },
  };
}

export type Windows = ReturnType<typeof createWindows>;
