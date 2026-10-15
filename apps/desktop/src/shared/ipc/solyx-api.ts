import type { AgentApi, AgentEvents } from "./agent.ts";
import type { BackupApi, BackupEvents } from "./backup.ts";
import type { CalendarApi } from "./calendar.ts";
import type { FlowsApi } from "./flows.ts";
import type { FundamentalsApi } from "./fundamentals.ts";
import type { MarketApi, MarketEvents } from "./market.ts";
import type { MemoryApi, MemoryEvents } from "./memory.ts";
import type { NewsApi, NewsEvents } from "./news.ts";
import type { ResearchApi, ResearchEvents } from "./research.ts";
import type { SchedulesApi, SchedulesEvents } from "./schedules.ts";
import type { SettingsApi, SettingsEvents } from "./settings.ts";
import type { StorageApi } from "./storage.ts";
import type { ThemesApi, ThemesEvents } from "./themes.ts";
import type { UpdatesApi, UpdatesEvents } from "./updates.ts";
import type { WatchlistApi, WatchlistEvents } from "./watchlist.ts";
import type { WorkspaceApi, WorkspaceEvents } from "./workspace.ts";

/** Everything the renderer can ask of the main process, exposed as `window.solyx`, one key per module. */
export interface SolyxApi {
  agent: AgentApi & AgentEvents;
  backup: BackupApi & BackupEvents;
  calendar: CalendarApi;
  flows: FlowsApi;
  fundamentals: FundamentalsApi;
  market: MarketApi & MarketEvents;
  memory: MemoryApi & MemoryEvents;
  news: NewsApi & NewsEvents;
  research: ResearchApi & ResearchEvents;
  schedules: SchedulesApi & SchedulesEvents;
  settings: SettingsApi & SettingsEvents;
  storage: StorageApi;
  themes: ThemesApi & ThemesEvents;
  updates: UpdatesApi & UpdatesEvents;
  watchlist: WatchlistApi & WatchlistEvents;
  workspace: WorkspaceApi & WorkspaceEvents;
}
