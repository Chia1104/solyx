import type { AccountApi } from "./account.ts";
import type { AgentApi, AgentEvents } from "./agent.ts";
import type { CalendarApi } from "./calendar.ts";
import type { MarketApi, MarketEvents } from "./market.ts";
import type { MemoryApi, MemoryEvents } from "./memory.ts";
import type { NewsApi, NewsEvents } from "./news.ts";
import type { ProposalsApi, ProposalsEvents } from "./proposals.ts";
import type { ResearchApi, ResearchEvents } from "./research.ts";
import type { SettingsApi, SettingsEvents } from "./settings.ts";
import type { StorageApi } from "./storage.ts";
import type { UpdatesApi, UpdatesEvents } from "./updates.ts";
import type { WatchlistApi } from "./watchlist.ts";

/** Everything the renderer can ask of the main process, exposed as `window.solyx`, one key per module. */
export interface SolyxApi {
  account: AccountApi;
  agent: AgentApi & AgentEvents;
  calendar: CalendarApi;
  market: MarketApi & MarketEvents;
  memory: MemoryApi & MemoryEvents;
  news: NewsApi & NewsEvents;
  proposals: ProposalsApi & ProposalsEvents;
  research: ResearchApi & ResearchEvents;
  settings: SettingsApi & SettingsEvents;
  storage: StorageApi;
  updates: UpdatesApi & UpdatesEvents;
  watchlist: WatchlistApi;
}
