import { oc, type } from "@orpc/contract";
import * as z from "zod";

import type { FubonFile } from "#shared/settings.ts";

import type { WindowPaint } from "../backend/host.ts";

/** A row of the tray's menu as the main process draws it; `null` for a rule between groups. */
export type HostTrayRow = { label: string; selectable: boolean } | null;

/** What the backend asks of the main process, which alone may call Electron's main-process APIs. */
export const hostContract = {
  /** The services are built and the windows painted, so a window may open. */
  ready: oc.output(type<void>()),
  /** The services could not start: the main process shows why and quits. */
  refuse: oc
    .input(type<{ title: string; body: string }>())
    .output(type<void>()),
  cipher: {
    available: oc.output(type<boolean>()),
    /** Ciphertext crosses the port as base64. */
    encrypt: oc.input(z.string()).output(type<string>()),
    decrypt: oc
      .input(z.base64())
      .output(type<{ plainText: string; shouldReEncrypt: boolean }>()),
  },
  updater: {
    /** The version the feed offers past this one; `null` when none is. */
    check: oc.output(type<string | null>()),
    download: oc.output(type<void>()),
    install: oc.output(type<void>()),
  },
  openExternal: oc.input(z.string()).output(type<void>()),
  showWindow: oc.output(type<void>()),
  paintWindows: oc.input(type<WindowPaint>()).output(type<void>()),
  tray: {
    /** Shows the icon with `rows`, numbered `menu` so a pick from an older menu is told apart. */
    show: oc
      .input(
        type<{
          menu: number;
          rows: HostTrayRow[];
          waiting: number;
          hint?: string;
        }>()
      )
      .output(type<void>()),
    hide: oc.output(type<void>()),
    setDockVisible: oc.input(z.boolean()).output(type<void>()),
    quit: oc.output(type<void>()),
  },
  /** Asks for one of Fubon's files over the window, by its page's `webContents` id. */
  chooseFubonFile: oc
    .input(type<{ file: FubonFile; window: number }>())
    .output(type<string | null>()),
  showItemInFolder: oc.input(z.string()).output(type<void>()),
  restart: oc.output(type<void>()),
  fubon: {
    /** Starts a Fubon process and posts the backend its port, tagged with `id`, on the parent port. */
    open: oc.input(z.uuid()).output(type<void>()),
    kill: oc.input(z.uuid()).output(type<void>()),
  },
};
