import { dirname, join } from "node:path";

import { Menu, Tray, app, nativeImage } from "electron";

import type { HostTrayRow } from "../../utility/host.contract.ts";

import { APP_ICON } from "./main-window.ts";

/**
 * Exported from `resources/tray.svg` in black on clear, which macOS tints for the menu bar it sits
 * in; the `@2x` file beside it serves Retina displays.
 */
const TEMPLATE_ICON = join(dirname(APP_ICON), "trayTemplate.png");

/** The size Windows and Linux scale down from for their trays. */
const ICON_SIZE = 32;

const isMac = process.platform === "darwin";

// Only macOS tints a template, so the other trays show the app's own icon.
const icon = () =>
  isMac
    ? nativeImage.createFromPath(TEMPLATE_ICON)
    : nativeImage
        .createFromPath(APP_ICON)
        .resize({ width: ICON_SIZE, height: ICON_SIZE, quality: "best" });

// Windows and Linux read `&` as marking the next letter's shortcut, and a row may hold a name the user wrote.
const label = (text: string) => (isMac ? text : text.replaceAll("&", "&&"));

/** The tray's icon and the Dock; `openWindow` brings the app's window to the front. */
export function createTrayIcon(openWindow: () => void) {
  const { dock } = app;
  let tray: Tray | undefined;

  return {
    /**
     * Puts the icon in the tray with `rows` as its menu, or gives the icon there that menu; a pick
     * calls `pick` with the row's place.
     */
    show(
      view: { rows: HostTrayRow[]; waiting: number; hint?: string },
      pick: (row: number) => void
    ) {
      const { rows, waiting, hint } = view;

      if (!tray) {
        tray = new Tray(icon());

        // Windows opens the menu on a right click alone, so a click on the icon opens the window.
        if (process.platform === "win32") tray.on("click", openWindow);
      }

      tray.setContextMenu(
        Menu.buildFromTemplate(
          rows.map((row, index) =>
            row === null
              ? { type: "separator" }
              : row.selectable
                ? { label: label(row.label), click: () => pick(index) }
                : { label: label(row.label), enabled: false }
          )
        )
      );

      // The app's name tells a nightly or a development build's icon from the stable one's.
      tray.setToolTip(hint ? `${app.getName()}: ${hint}` : app.getName());

      // Only the menu bar has room for the count beside the icon; the Dock's icon carries it too.
      if (isMac) tray.setTitle(waiting > 0 ? String(waiting) : "");

      app.setBadgeCount(waiting);
    },

    hide() {
      tray?.destroy();
      tray = undefined;
      app.setBadgeCount(0);
    },

    setDockVisible(visible: boolean) {
      if (!dock || visible === dock.isVisible()) return;

      if (visible) void dock.show();
      else dock.hide();
    },
  };
}
