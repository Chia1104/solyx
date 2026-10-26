import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import type { RouterContractClient } from "@orpc/contract";
import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import { captureException, init } from "@sentry/electron/utility";

import { resolveLocale } from "@solyx/api/settings";
import { SettingsSection } from "@solyx/api/settings-section";
import { DestinationKind } from "@solyx/api/workspace";
import { RestoreFailure } from "@solyx/backend/modules/backup/staged-restore";
import { CATALOGS, fill } from "@solyx/backend/modules/settings/catalogs";
import { createConfigFile } from "@solyx/backend/modules/settings/config-file";
import type { ReportError } from "@solyx/backend/modules/telemetry/diagnostics";
import { ClientKind } from "@solyx/backend/rpc/context";
import { keepMessages } from "@solyx/backend/rpc/messages";
import { serveClient, serveSocket } from "@solyx/backend/rpc/serve";
import { createServices } from "@solyx/backend/services";
import type { Services } from "@solyx/backend/services";
import { errorMessage } from "@solyx/utils/error";

import { createBackendHost } from "./backend-host.ts";
import type { BackendHost } from "./backend-host.ts";
import { BackendMessageKind, backendContract } from "./backend.contract.ts";
import type { BackendMessage, BackendStart } from "./backend.contract.ts";
import type { hostContract } from "./host.contract.ts";

/** The main process scrubs a report and sends it only once the user agrees. */
const reportError: ReportError = (cause, tags) => {
  captureException(cause, { tags });
};

const backend = implement(backendContract);

/** Serves what the main process tells the backend on `port`. */
function serveBackend(
  port: Electron.MessagePortMain,
  services: Services,
  backendHost: BackendHost
) {
  new RPCHandler(
    backend.router({
      windows: backend.windows.handler(({ input }) => {
        backendHost.windowsOpen(input);
        void services.tray.sync();
      }),
      trayRow: backend.trayRow.handler(({ input }) =>
        backendHost.pickTrayRow(input.menu, input.row)
      ),
      wake: backend.wake.handler(() => services.scheduler.tick()),
      staysOpen: backend.staysOpen.handler(() => services.tray.staysOpen()),
      processExited: backend.processExited.handler(({ input }) =>
        backendHost.processExited(input.id, input.code)
      ),
      // Runs still going are stored where they stopped and continue at the next start, and stdio
      // MCP servers are shut down rather than left running without the app. Traces last, so they
      // hold how the runs stopped.
      close: backend.close.handler(async () => {
        services.scheduler.stop();
        services.tray.close();
        await services.devices.close();
        await services.agent.close();
        await services.sandbox?.close();
        await services.telemetry.close();
      }),
    }),
    { clientInterceptors: [keepMessages] }
  ).upgrade(port);
  port.start();
}

function start(
  started: BackendStart,
  [hostPort, backendPort]: Electron.MessagePortMain[]
) {
  if (started.canReportCrashes) {
    // Otherwise every request the backend makes carries Sentry's trace headers.
    init({ tracePropagationTargets: [] });
  }

  const client: RouterContractClient<typeof hostContract> = createORPCClient(
    new RPCLink({ port: hostPort })
  );

  hostPort.start();

  const backendHost = createBackendHost({
    start: started,
    client,
    reportError,
  });

  const config = createConfigFile(started.configFile);

  let services: Services;

  try {
    services = createServices(config, backendHost.host);
  } catch (error) {
    if (!(error instanceof RestoreFailure)) throw error;

    // A restored backup that could not be put in place: the app says so and exits rather than
    // start on half of each, and tries again the next time it starts.
    const copy =
      CATALOGS[resolveLocale(config.read().appearance.language, started.locale)]
        .settings.backup["restore-stuck"];

    void client.refuse({
      title: copy.title,
      body: fill(copy.body, {
        reason: errorMessage(error.cause),
        folder: error.folder,
      }),
    });

    return;
  }

  serveBackend(backendPort, services, backendHost);

  process.parentPort.on(
    "message",
    ({
      data,
      ports: [port],
    }: {
      data: BackendMessage;
      ports: Electron.MessagePortMain[];
    }) => {
      if (!port) return;

      if (data.kind === BackendMessageKind.Window) {
        serveClient(port, {
          ...services,
          client: { kind: ClientKind.Window, window: data.window },
        });
      } else if (data.kind === BackendMessageKind.Process) {
        backendHost.processPort(data.id, port);
      }
    }
  );

  void client.ready();

  // Paired browsers reach the router through the edge, while the user has it on.
  void services.devices.listen((socket, device, origin) =>
    serveSocket(socket, {
      ...services,
      client: { kind: ClientKind.Device, device: device.id, origin },
    })
  );

  // The window opens where the restore was asked for, which says what became of it.
  if (services.restored) {
    services.workspace.open({
      kind: DestinationKind.Settings,
      section: SettingsSection.Backup,
    });
  }

  void services.tray.sync();

  // Runs the last session left unfinished continue where they stopped. A store that cannot open
  // fails every agent call too, which the renderer shows.
  services.agent
    .resume()
    .catch((error) =>
      services.telemetry.diagnostics.report(error, "agent.resume")
    );

  services.scheduler.start();
}

// The main process starts the backend with the host's port and the backend's own.
process.parentPort.once(
  "message",
  ({
    data,
    ports,
  }: {
    data: BackendMessage;
    ports: Electron.MessagePortMain[];
  }) => {
    if (data.kind === BackendMessageKind.Start) start(data.start, ports);
  }
);
