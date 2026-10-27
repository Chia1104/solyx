import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type { RouterContractClient } from "@orpc/contract";
import { net } from "electron";
import { noop } from "es-toolkit";

import type { Host } from "@solyx/backend/host";
import { connectKernel } from "@solyx/backend/modules/kernel/kernel-client";
import { connectFubon } from "@solyx/backend/modules/market/fubon-client";
import type { ReportError } from "@solyx/backend/modules/telemetry/diagnostics";

import type { BackendStart } from "./backend.contract.ts";
import { UtilityKind } from "./host.contract.ts";
import type { hostContract } from "./host.contract.ts";

interface BackendHostOptions {
  start: BackendStart;
  client: RouterContractClient<typeof hostContract>;
  reportError: ReportError;
}

/**
 * The services' host in the backend's utility process: what the main process told it as it
 * started, and the rest asked of the main process over the host's port. It also takes what the
 * main process tells of windows, the tray's menu and the processes it started for the backend.
 */
export function createBackendHost({
  start,
  client,
  reportError,
}: BackendHostOptions) {
  /** Sends a call that answers nothing; one failing means the main process is going away. */
  function send(event: string, call: Promise<unknown>) {
    void call.catch((error) => reportError(error, { event: `host.${event}` }));
  }

  let windows = 0;
  let menu = 0;
  let picks: (() => void)[] = [];

  const processPorts = new Map<
    string,
    (port: Electron.MessagePortMain) => void
  >();

  const processExits = new Map<string, (code: number) => void>();

  /** Has the main process start a process of `kind`, which serves the backend on the port it hands over. */
  async function openProcess(kind: UtilityKind) {
    const id = randomUUID();

    // The port comes on the parent port, which may beat or trail the call's answer.
    const handed = new Promise<Electron.MessagePortMain>((resolve) =>
      processPorts.set(id, resolve)
    );

    // Kept from before the process starts, so an end that comes before its client listens is told.
    let exited: number | undefined;
    let onExit: ((code: number) => void) | undefined;

    processExits.set(id, (code) => {
      exited = code;
      onExit?.(code);
    });

    try {
      await client.processes.open({ kind, id });
    } catch (error) {
      processPorts.delete(id);
      processExits.delete(id);
      throw error;
    }

    const port = await handed;

    port.start();

    return {
      port,
      child: {
        on(_event: "exit", listener: (code: number) => void) {
          onExit = listener;

          if (exited !== undefined) listener(exited);
        },
        kill: () => send("processes.kill", client.processes.kill(id)),
      },
    };
  }

  const host: Host = {
    name: start.name,
    version: start.version,
    channel: start.channel,
    locale: start.locale,
    dataDir: start.dataDir,
    // The desktop's build puts the renderer beside the backend's bundle.
    webRoot: join(import.meta.dirname, "../renderer"),
    homeDir: start.homeDir,

    cipher: {
      isAvailable: () => client.cipher.available(),
      encrypt: async (plainText) =>
        Buffer.from(await client.cipher.encrypt(plainText), "base64"),
      decrypt: (encrypted) =>
        client.cipher.decrypt(encrypted.toString("base64")),
    },

    updater: start.updater && {
      installs: start.updater.installs,
      check: () => client.updater.check(),
      download: () => client.updater.download(),
      install: () => send("updater.install", client.updater.install()),
    },

    reportError,

    // Chromium's own network stack in this process, which no window shares.
    chromiumFetch: (input, init) =>
      net.fetch(input instanceof URL ? input.href : input, {
        ...init,
        credentials: "omit",
        cache: "no-store",
      }),

    async openFubonProcess(options) {
      const { child, port } = await openProcess(UtilityKind.Fubon);

      return connectFubon(child, port, options);
    },

    async openKernelProcess() {
      const { child, port } = await openProcess(UtilityKind.Kernel);

      return connectKernel(child, port);
    },

    openExternal: (url) => send("open-external", client.openExternal(url)),
    showWindow: () => send("show-window", client.showWindow()),
    paintWindows: (paint) => send("paint-windows", client.paintWindows(paint)),

    tray: {
      hasWindows: () => windows > 0,
      quit: () => send("tray.quit", client.tray.quit()),
      show({ rows, waiting, hint }) {
        menu += 1;
        picks = rows.map((row) => row?.select ?? noop);
        send(
          "tray.show",
          client.tray.show({
            menu,
            rows: rows.map(
              (row) =>
                row && {
                  label: row.label,
                  selectable: row.select !== undefined,
                }
            ),
            waiting,
            hint,
          })
        );
      },
      hide: () => send("tray.hide", client.tray.hide()),
      dock: start.hasDock
        ? {
            setVisible: (visible) =>
              send("tray.dock", client.tray.setDockVisible(visible)),
          }
        : undefined,
    },

    settings: {
      chooseFubonFile: (file, window) =>
        client.chooseFubonFile({ file, window }),
      showItemInFolder: (path) =>
        send("show-item-in-folder", client.showItemInFolder(path)),
      about: () => start.about,
      canReportCrashes: start.canReportCrashes,
      hasDock: start.hasDock,
    },

    restart: () => send("restart", client.restart()),
    trashItem: (path) => client.trashItem(path),
  };

  return {
    host,

    /** How many windows are open, which the tray reads as it syncs. */
    windowsOpen(count: number) {
      windows = count;
    },

    /** Runs what a row of the tray's menu does, unless the menu has changed since it was drawn. */
    pickTrayRow(drawn: number, row: number) {
      if (drawn === menu) picks[row]?.();
    },

    /** Hands process `id` the port the main process posted for it. */
    processPort(id: string, port: Electron.MessagePortMain) {
      processPorts.get(id)?.(port);
      processPorts.delete(id);
    },

    processExited(id: string, code: number) {
      processExits.get(id)?.(code);
      processExits.delete(id);
    },
  };
}

export type BackendHost = ReturnType<typeof createBackendHost>;
