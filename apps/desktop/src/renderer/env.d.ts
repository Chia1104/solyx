import type { SolyxApi } from "../shared/ipc.ts";

declare global {
  interface Window {
    solyx: SolyxApi;
  }
}
