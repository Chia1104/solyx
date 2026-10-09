import {
  IPCMode,
  init,
  makeElectronOfflineTransport,
  makeElectronTransport,
} from "@sentry/electron/main";
import { app } from "electron";

import { scrubEvent } from "./scrub-event.ts";

// Written into the bundle by `vp pack` from the release workflow, so development builds and forks
// have nowhere to send reports.
const DSN = process.env.SENTRY_DSN ?? "";

/** This build has somewhere to send crash reports. */
export const canReportCrashes = app.isPackaged && DSN !== "";

/**
 * Starts Sentry in the main process, which sends the renderer's reports too. Call it before the app
 * is ready. Everything Sentry would send, queued reports included, is dropped at the transport
 * while `sending` says the user has not agreed, so switching reports on or off applies at once.
 */
export function startCrashReports(sending: () => boolean) {
  if (!canReportCrashes) return;

  const version = app.getVersion();
  const home = app.getPath("home");

  init({
    dsn: DSN,
    // The release the package workflow uploads the renderer's source maps to.
    release: `solyx@${version}`,
    environment: version.includes("-nightly.") ? "nightly" : "stable",
    // The preload carries Sentry's bridge, so the renderer needs no protocol of its own.
    ipcMode: IPCMode.Classic,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    // Otherwise Sentry rewrites the message of every failed fetch, reported or not.
    enhanceFetchErrorMessages: false,
    // A minidump holds the crashed process's memory, decrypted keys included; a renderer or
    // utility process that crashes is still reported as it ends, without one.
    integrations: (defaults) =>
      defaults.filter(({ name }) => name !== "SentryMinidump"),
    beforeSend: (event) => scrubEvent(event, home),
    transport: makeElectronOfflineTransport((options) => {
      const transport = makeElectronTransport(options);

      return {
        send: async (envelope) => (sending() ? transport.send(envelope) : {}),
        flush: (timeout) => transport.flush(timeout),
      };
    }),
  });
}
