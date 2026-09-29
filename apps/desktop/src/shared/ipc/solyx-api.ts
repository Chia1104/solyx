import type { AccountApi } from "./account.ts";
import type { MarketApi } from "./market.ts";
import type { ProposalsApi } from "./proposals.ts";
import type { SettingsApi } from "./settings.ts";

/** Everything the renderer can ask of the main process, exposed as `window.solyx`, one key per module. */
export interface SolyxApi {
  account: AccountApi;
  market: MarketApi;
  proposals: ProposalsApi;
  settings: SettingsApi;
}
