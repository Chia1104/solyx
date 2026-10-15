// Sentry's bridge, which hands the renderer's reports to the main process; it sends nothing itself.
import "@sentry/electron/preload";
import { ipcRenderer } from "electron";

import { RPC_CONNECT } from "#shared/rpc/connect.ts";

// The window keeps one end of its channel and posts the other here, which goes on to the main
// process; the preload never holds a port itself and exposes nothing to the page.
window.addEventListener("message", (event) => {
  if (event.data === RPC_CONNECT) {
    ipcRenderer.postMessage(RPC_CONNECT, null, [...event.ports]);
  }
});
