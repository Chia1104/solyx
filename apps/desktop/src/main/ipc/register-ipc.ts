import { registerAccountIpc } from "../modules/account/account-ipc.ts";
import { registerAgentIpc } from "../modules/agent/agent-ipc.ts";
import { registerCalendarIpc } from "../modules/calendar/calendar-ipc.ts";
import { registerFlowsIpc } from "../modules/flows/flows-ipc.ts";
import { registerMarketIpc } from "../modules/market/market-ipc.ts";
import { registerMemoryIpc } from "../modules/memory/memory-ipc.ts";
import { registerNewsIpc } from "../modules/news/news-ipc.ts";
import { registerProposalsIpc } from "../modules/proposals/proposals-ipc.ts";
import { registerResearchIpc } from "../modules/research/research-ipc.ts";
import { registerSchedulesIpc } from "../modules/schedules/schedules-ipc.ts";
import { registerSettingsIpc } from "../modules/settings/settings-ipc.ts";
import { registerStorageIpc } from "../modules/storage/storage-ipc.ts";
import { registerThemesIpc } from "../modules/themes/themes-ipc.ts";
import { registerUpdatesIpc } from "../modules/updates/updates-ipc.ts";
import { registerWatchlistIpc } from "../modules/watchlist/watchlist-ipc.ts";
import { registerWorkspaceIpc } from "../modules/workspace/workspace-ipc.ts";
import type { Services } from "../services.ts";

export function registerIpc(services: Services) {
  registerAccountIpc(services);
  registerAgentIpc(services);
  registerCalendarIpc(services);
  registerFlowsIpc(services);
  registerMarketIpc(services);
  registerMemoryIpc(services);
  registerNewsIpc(services);
  registerProposalsIpc(services);
  registerResearchIpc(services);
  registerSchedulesIpc(services);
  registerSettingsIpc(services);
  registerStorageIpc(services);
  registerThemesIpc(services);
  registerUpdatesIpc(services);
  registerWatchlistIpc(services);
  registerWorkspaceIpc(services);
}
