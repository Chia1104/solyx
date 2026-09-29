import type { AccountApi } from "./account.ts";
import type { MarketApi, MarketEvents } from "./market.ts";
import type { ProposalsApi } from "./proposals.ts";
import type { SettingsApi } from "./settings.ts";
import type { WatchlistApi } from "./watchlist.ts";

/** Everything the renderer can ask of the main process, exposed as `window.solyx`, one key per module. */
export interface SolyxApi {
  account: AccountApi;
  market: MarketApi & MarketEvents;
  proposals: ProposalsApi;
  settings: SettingsApi;
  watchlist: WatchlistApi;
}
