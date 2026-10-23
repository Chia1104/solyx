import type { AppChannel } from "@solyx/api/app-channel";
import type { ColorScheme, PaletteColors } from "@solyx/api/palette";
import type { Theme } from "@solyx/api/settings";
import type { FubonSessionOptions } from "@solyx/brokers/fubon";

import type { FubonProcess } from "./modules/market/fubon-client.ts";
import type { SecretCipher } from "./modules/settings/secret-store.ts";
import type { SettingsShell } from "./modules/settings/settings.route.ts";
import type { ReportError } from "./modules/telemetry/diagnostics.ts";
import type { TrayShell } from "./modules/tray/tray.ts";
import type { Updater } from "./modules/updates/updates.ts";

/** What the app's windows show: the theme, and the palette of each scheme the theme may pick. */
export interface WindowPaint {
  theme: Theme;
  colors: Record<ColorScheme, PaletteColors>;
}

/**
 * What the services ask of the process that runs them, the only code that touches Electron. Every
 * fact here is fixed for the app's run.
 */
export interface Host {
  /** The app's name, which names its data, its config folder and its secret store entry. */
  name: string;
  version: string;
  channel: AppChannel;
  /** The computer's language, which the user's own pick overrides. */
  locale: string;
  /** Where the app keeps its secrets, caches and databases. */
  dataDir: string;
  homeDir: string;
  cipher: SecretCipher;
  /** The channel's update feed; `null` where the build has none. */
  updater: Updater | null;
  reportError: ReportError;
  /**
   * `fetch` over Chromium's network stack instead of Node's, for a server whose certificate
   * verifies only once the intermediate it leaves out of its chain is fetched, as a browser does.
   * It writes no cookie or cached answer to disk and shares none with a window.
   */
  chromiumFetch: typeof fetch;
  openFubonProcess(options: FubonSessionOptions): Promise<FubonProcess>;
  /** Opens `url` in the user's browser. */
  openExternal(url: string): void;
  /** Brings the app's window to the front, opening one when none is. */
  showWindow(): void;
  /** Gives the windows open now, and those opened later, what they show. */
  paintWindows(paint: WindowPaint): void;
  tray: TrayShell;
  settings: SettingsShell;
  /** Quits the app and starts it again; quitting closes what is open first, as any quit does. */
  restart(): void;
}
