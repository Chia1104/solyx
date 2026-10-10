/** One row of the tray's menu; `null` rules one group off from the next. */
export type TrayRow = { label: string; select: () => void } | null;

/** What only Electron does for the tray. */
export interface TrayShell {
  hasWindows(): boolean;
  /** Brings the app's window to the front, opening one when none is. */
  openWindow(): void;
  quit(): void;
  /** Puts the icon in the tray with `rows` as its menu, or gives the icon there those rows. */
  show(rows: TrayRow[]): void;
  /** Takes the icon out of the tray. */
  hide(): void;
  /** The Dock, where the computer has one. */
  dock?: { setVisible(visible: boolean): void };
}

export interface TrayOptions {
  /** Read afresh at every `sync`. */
  settings: () => { show: boolean; hideDock: boolean };
  /** The menu's words in the app's language, read afresh at every `sync`. */
  copy: () => { open: string; quit: string };
  shell: TrayShell;
}

/**
 * The app's icon in the menu bar or the system tray, where the app stays open once its last
 * window closes, so the clock's work goes on with somewhere to bring the window back from.
 */
export function createTray({ settings, copy, shell }: TrayOptions) {
  let shown = false;

  return {
    /** Shows what the settings ask for now; called whenever they, the language or the windows change. */
    sync() {
      const { show, hideDock } = settings();

      if (show) {
        const { open, quit } = copy();

        shell.show([
          { label: open, select: () => shell.openWindow() },
          null,
          { label: quit, select: () => shell.quit() },
        ]);
      } else if (shown) {
        shell.hide();
      }

      shown = show;

      // Out of the Dock only while the icon is there to bring the app back from.
      shell.dock?.setVisible(!(show && hideDock) || shell.hasWindows());
    },

    /** Whether the app goes on once its last window closes: in the tray, or in the Dock as a macOS app does. */
    staysOpen: () => shown || shell.dock !== undefined,

    /** Takes the icon away as the app quits, since Windows would keep showing it. */
    close() {
      if (shown) shell.hide();

      shown = false;
    },
  };
}

export type Tray = ReturnType<typeof createTray>;
