import { registerAccountIpc } from "../modules/account/account-ipc.ts";
import { registerAgentIpc } from "../modules/agent/agent-ipc.ts";
import { registerMarketIpc } from "../modules/market/market-ipc.ts";
import { registerNewsIpc } from "../modules/news/news-ipc.ts";
import { registerProposalsIpc } from "../modules/proposals/proposals-ipc.ts";
import { registerSettingsIpc } from "../modules/settings/settings-ipc.ts";
import { registerWatchlistIpc } from "../modules/watchlist/watchlist-ipc.ts";
import type { Services } from "../services.ts";

export function registerIpc(services: Services) {
  registerAccountIpc(services);
  registerAgentIpc(services);
  registerMarketIpc(services);
  registerNewsIpc(services);
  registerProposalsIpc(services);
  registerSettingsIpc(services);
  registerWatchlistIpc(services);
}
