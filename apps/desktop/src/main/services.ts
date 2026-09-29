import { join } from "node:path";

import { app } from "electron";

import { createPaperBroker } from "@solyx/brokers/paper";
import { Market } from "@solyx/core/market";
import type { MarketDataProvider } from "@solyx/core/market-data";
import { OrderDesk } from "@solyx/core/order-desk";
import type { RiskLimits } from "@solyx/core/risk";
import { Session, getSession } from "@solyx/core/session";
import { openCache } from "@solyx/db/cache";
import { withCandleCache } from "@solyx/market-data/candle-cache";
import {
  FUGLE_PLANS,
  FuglePlan,
  createFugleMarketData,
  createFugleStream,
  fuglePlanSchema,
} from "@solyx/market-data/fugle";

import { MARKET_DATA_SECRET } from "#shared/ipc/settings.ts";
import type { ProviderPlans } from "#shared/ipc/settings.ts";

import { createLiveCandles } from "./modules/market/live-candles.ts";
import { createConfigFile } from "./modules/settings/config-file.ts";
import { electronCipher } from "./modules/settings/electron-cipher.ts";
import { createSecretStore } from "./modules/settings/secret-store.ts";

const PAPER_CASH = { TWD: 1_000_000, USD: 30_000 };

// Paper trading is allowed around the clock so the flow can be tried after the close.
const PAPER_LIMITS: RiskLimits = {
  maxOrderNotional: PAPER_CASH,
  allowedSessions: Object.values(Session),
};

/** Composition root. A live broker is only ever wired here after the user explicitly turns it on. */
export function createServices() {
  const broker = createPaperBroker({ cash: PAPER_CASH });

  const desk = new OrderDesk({
    broker,
    limits: PAPER_LIMITS,
    // No quote feed yet, so market orders are rejected for lack of a reference price.
    riskContext: async (order) => ({
      session: getSession(order.instrument.market),
    }),
  });

  const secrets = createSecretStore(
    join(app.getPath("userData"), "secrets.json"),
    electronCipher
  );

  const cache = openCache(
    join(app.getPath("userData"), "cache.sqlite"),
    // vp pack copies the migrations next to the bundle; see vite.config.ts.
    join(import.meta.dirname, "migrations", "cache")
  );

  const config = createConfigFile(join(app.getPath("userData"), "config.json"));

  // A plan the provider no longer sells, or a hand edit it does not know, means its free plan.
  const fuglePlan = () =>
    fuglePlanSchema.catch(FuglePlan.Basic).parse(config.providerPlan("fugle"));

  let fugle:
    | { apiKey: string; plan: FuglePlan; provider: MarketDataProvider }
    | undefined;

  // One provider per key and plan, so its request budgets hold across requests; the key is
  // read per request, so a key saved in settings applies without a restart.
  async function marketData(
    market: Market
  ): Promise<MarketDataProvider | undefined> {
    if (market !== Market.TW) return undefined;

    const apiKey = await secrets.get(MARKET_DATA_SECRET[Market.TW]);

    if (apiKey === undefined) return undefined;

    const plan = fuglePlan();

    if (fugle?.apiKey !== apiKey || fugle.plan !== plan) {
      fugle = {
        apiKey,
        plan,
        provider: withCandleCache(
          createFugleMarketData({ apiKey, plan }),
          cache.candles
        ),
      };
    }

    return fugle.provider;
  }

  const liveCandles = createLiveCandles({
    async openStream() {
      const apiKey = await secrets.get(MARKET_DATA_SECRET[Market.TW]);

      return apiKey === undefined
        ? undefined
        : createFugleStream({ apiKey, plan: fuglePlan() });
    },
    async dailyCandles(request) {
      const provider = await marketData(request.symbol.market);

      return provider ? provider.getCandles(request) : [];
    },
  });

  const providerPlans = {
    current: (): ProviderPlans => ({
      fugle: { plan: fuglePlan(), plans: Object.values(FUGLE_PLANS) },
    }),

    async set(provider: keyof ProviderPlans, plan: string) {
      config.setProviderPlan(provider, fuglePlanSchema.parse(plan));
      // The stream's capacity comes from the plan, so it reopens under the new one.
      await liveCandles.restart();
    },
  };

  return {
    broker,
    desk,
    secrets,
    marketData,
    liveCandles,
    providerPlans,
  };
}

export type Services = ReturnType<typeof createServices>;
