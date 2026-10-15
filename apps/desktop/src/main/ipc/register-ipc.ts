import { registerAgentIpc } from "../modules/agent/agent-ipc.ts";
import { registerMarketIpc } from "../modules/market/market-ipc.ts";
import { registerSettingsIpc } from "../modules/settings/settings-ipc.ts";
import type { Services } from "../services.ts";

export function registerIpc(services: Services) {
  registerAgentIpc(services);
  registerMarketIpc(services);
  registerSettingsIpc(services);
}
