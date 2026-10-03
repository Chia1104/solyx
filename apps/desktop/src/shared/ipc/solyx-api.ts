import type { AccountApi } from "./account.ts";
import type { AgentApi, AgentEvents } from "./agent.ts";
import type { MarketApi, MarketEvents } from "./market.ts";
import type { NewsApi, NewsEvents } from "./news.ts";
import type { ProposalsApi } from "./proposals.ts";
import type { SettingsApi, SettingsEvents } from "./settings.ts";
import type { WatchlistApi } from "./watchlist.ts";

/** Everything the renderer can ask of the main process, exposed as `window.solyx`, one key per module. */
export interface SolyxApi {
  account: AccountApi;
  agent: AgentApi & AgentEvents;
  market: MarketApi & MarketEvents;
  news: NewsApi & NewsEvents;
  proposals: ProposalsApi;
  settings: SettingsApi & SettingsEvents;
  watchlist: WatchlistApi;
}
