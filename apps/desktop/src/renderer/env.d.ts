import type { SolyxApi } from "#shared/ipc/solyx-api.ts";

declare global {
  interface Window {
    solyx: SolyxApi;
  }
}
