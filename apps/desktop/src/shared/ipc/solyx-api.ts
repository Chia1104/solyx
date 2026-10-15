import type { AgentApi, AgentEvents } from "./agent.ts";
import type { MarketApi, MarketEvents } from "./market.ts";

/** Everything the renderer can ask of the main process, exposed as `window.solyx`, one key per module. */
export interface SolyxApi {
  agent: AgentApi & AgentEvents;
  market: MarketApi & MarketEvents;
}
