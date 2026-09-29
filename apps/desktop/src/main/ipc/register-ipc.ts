import { registerAccountIpc } from "../modules/account/account-ipc.ts";
import { registerMarketIpc } from "../modules/market/market-ipc.ts";
import { registerProposalsIpc } from "../modules/proposals/proposals-ipc.ts";
import { registerSettingsIpc } from "../modules/settings/settings-ipc.ts";
import type { Services } from "../services.ts";

export function registerIpc(services: Services) {
  registerAccountIpc(services);
  registerMarketIpc(services);
  registerProposalsIpc(services);
  registerSettingsIpc(services);
}
