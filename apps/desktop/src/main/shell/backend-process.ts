import { join } from "node:path";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import type { RouterContractClient } from "@orpc/contract";
import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import { MessageChannelMain, app, shell, utilityProcess } from "electron";
import type { MessagePortMain, UtilityProcess } from "electron";

import { keepMessages } from "@solyx/backend/rpc/messages";

import { BackendMessageKind } from "../../utility/backend.contract.ts";
import type {
  BackendMessage,
  BackendStart,
  backendContract,
} from "../../utility/backend.contract.ts";
import { hostContract } from "../../utility/host.contract.ts";

import { appChannel } from "./app-channel.ts";
import { createAppUpdater } from "./app-updater.ts";
import { reportError } from "./crash-reports.ts";
import { electronCipher } from "./electron-cipher.ts";
import type { Windows } from "./main-window.ts";
import { settingsShell } from "./settings-shell.ts";
import { createTrayIcon } from "./tray-icon.ts";
import { forkUtility } from "./utility-process.ts";

// Main is bundled into dist/main, next to dist/utility.
const BACKEND_ENTRY = join(import.meta.dirname, "../utility/backend.mjs");

/** Why the backend would not start, as a dialog says it. */
export interface Refusal {
  title: string;
  body: string;
}

/**
 * Starts the backend in a utility process of its own, a process of this same binary, so the fuses
 * and the code signature that guard the secrets guard it too, and serves it what only the main
 * process can do: the secret store's key, the windows, the tray, dialogs and the processes it asks
 * for, Fubon's and the kernel's.
 */
export function startBackend(windows: Windows, configFile: string) {
  const child = utilityProcess.fork(BACKEND_ENTRY, [], {
    serviceName: "Backend",
  });

  const post = (message: BackendMessage, ports: MessagePortMain[]) =>
    child.postMessage(message, ports);

  const host = new MessageChannelMain();
  const own = new MessageChannelMain();

  const control: RouterContractClient<typeof backendContract> =
    createORPCClient(new RPCLink({ port: own.port1 }));

  /** Sends a call that answers nothing; one failing means the backend is going away. */
  function send(event: string, call: Promise<unknown>) {
    void call.catch((error) =>
      reportError(error, { event: `backend.${event}` })
    );
  }

  const updater = createAppUpdater();
  const tray = createTrayIcon(() => windows.show());
  const processes = new Map<string, UtilityProcess>();

  let settle: (refusal: Refusal | null) => void = () => undefined;

  /** `null` once the services are built, or why they were not. */
  const started = new Promise<Refusal | null>((resolve) => {
    settle = resolve;
  });

  const hosted = implement(hostContract);

  new RPCHandler(
    hosted.router({
      ready: hosted.ready.handler(() => settle(null)),
      refuse: hosted.refuse.handler(({ input }) => settle(input)),
      cipher: {
        available: hosted.cipher.available.handler(() =>
          electronCipher.isAvailable()
        ),
        encrypt: hosted.cipher.encrypt.handler(async ({ input }) =>
          (await electronCipher.encrypt(input)).toString("base64")
        ),
        decrypt: hosted.cipher.decrypt.handler(({ input }) =>
          electronCipher.decrypt(Buffer.from(input, "base64"))
        ),
      },
      updater: {
        check: hosted.updater.check.handler(() => feed().check()),
        download: hosted.updater.download.handler(() => feed().download()),
        install: hosted.updater.install.handler(() => feed().install()),
      },
      openExternal: hosted.openExternal.handler(
        ({ input }) => void shell.openExternal(input)
      ),
      showWindow: hosted.showWindow.handler(() => windows.show()),
      paintWindows: hosted.paintWindows.handler(({ input }) =>
        windows.paint(input)
      ),
      tray: {
        show: hosted.tray.show.handler(({ input }) =>
          tray.show(input, (row) =>
            send("tray-row", control.trayRow({ menu: input.menu, row }))
          )
        ),
        hide: hosted.tray.hide.handler(() => tray.hide()),
        setDockVisible: hosted.tray.setDockVisible.handler(({ input }) =>
          tray.setDockVisible(input)
        ),
        quit: hosted.tray.quit.handler(() => app.quit()),
      },
      chooseFubonFile: hosted.chooseFubonFile.handler(({ input }) =>
        settingsShell.chooseFubonFile(input.file, input.window)
      ),
      showItemInFolder: hosted.showItemInFolder.handler(({ input }) =>
        settingsShell.showItemInFolder(input)
      ),
      trashItem: hosted.trashItem.handler(({ input }) =>
        shell.trashItem(input)
      ),
      restart: hosted.restart.handler(() => {
        app.relaunch();
        app.quit();
      }),
      processes: {
        open: hosted.processes.open.handler(({ input: { kind, id } }) => {
          const { child, port } = forkUtility(kind);

          processes.set(id, child);
          child.on("exit", (code) => {
            processes.delete(id);
            send("process-exited", control.processExited({ id, code }));
          });

          post({ kind: BackendMessageKind.Process, id }, [port]);
        }),
        kill: hosted.processes.kill.handler(({ input: id }) => {
          processes.get(id)?.kill();
        }),
      },
    }),
    { clientInterceptors: [keepMessages] }
  ).upgrade(host.port1);

  /** The channel's update feed, which the backend asks only where the build has one. */
  function feed() {
    if (!updater) throw new Error("This build has no update feed");

    return updater;
  }

  const start: BackendStart = {
    configFile,
    name: app.getName(),
    version: app.getVersion(),
    channel: appChannel(),
    locale: app.getLocale(),
    dataDir: app.getPath("userData"),
    homeDir: app.getPath("home"),
    updater: updater && { installs: updater.installs },
    about: settingsShell.about(),
    canReportCrashes: settingsShell.canReportCrashes,
    hasDock: settingsShell.hasDock,
  };

  post({ kind: BackendMessageKind.Start, start }, [host.port2, own.port2]);
  host.port1.start();
  own.port1.start();

  return {
    control,
    /** `null` once the services are built, or why they were not. */
    started,
    /** Hands the backend a window's port, which it serves the router on as that window. */
    connectWindow(window: number, port: MessagePortMain) {
      post({ kind: BackendMessageKind.Window, window }, [port]);
    },
    /** Calls `listener` once the backend's process ends, with its exit code. */
    onExit(listener: (code: number) => void) {
      child.once("exit", listener);
    },
    send,
  };
}

export type Backend = ReturnType<typeof startBackend>;
