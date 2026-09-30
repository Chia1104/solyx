import { join } from "node:path";

import { app, nativeTheme } from "electron";
import { kebabCase } from "es-toolkit";

import { createPaperBroker } from "@solyx/brokers/paper";
import { OrderDesk } from "@solyx/core/order-desk";
import type { RiskLimits } from "@solyx/core/risk";
import { Session, getSession } from "@solyx/core/session";
import { openCache } from "@solyx/db/cache";
import { openUserData } from "@solyx/db/user";

import { AppLocation, Theme } from "#shared/ipc/settings.ts";

import { createLiveCandles } from "./modules/market/live-candles.ts";
import { createMarketDataSources } from "./modules/market/market-data-sources.ts";
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

  const userData = openUserData(
    join(app.getPath("userData"), "user.sqlite"),
    join(import.meta.dirname, "migrations", "user")
  );

  const desk = new OrderDesk({
    broker,
    store: userData.proposals,
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

  const home = app.getPath("home");

  // Settings a person edits live in a dotfolder named after the app, so each channel keeps its own.
  const config = createConfigFile(
    join(home, `.${kebabCase(app.getName())}`, "config.jsonc")
  );

  config.create();

  const marketData = createMarketDataSources({
    config,
    secrets,
    candles: cache.candles,
    fubonLogDir: join(app.getPath("userData"), "fubon"),
  });

  const liveCandles = createLiveCandles({
    openStream: () => marketData.openStream(),
    async dailyCandles(request) {
      const provider = await marketData.provider(request.symbol.market);

      return provider ? provider.getCandles(request) : [];
    },
  });

  let appliedStreamSettings = marketData.streamSettings();

  // Sources and plans change from the settings page or a hand edit; the live stream follows either.
  async function applySettings() {
    const next = marketData.streamSettings();

    if (next === appliedStreamSettings) return;

    appliedStreamSettings = next;
    await liveCandles.restart();
  }

  const theme = () => config.read().theme ?? Theme.System;

  // Windows and their renderers' prefers-color-scheme follow themeSource.
  const applyTheme = () => {
    nativeTheme.themeSource = theme();
  };

  applyTheme();

  config.watch(() => {
    applyTheme();
    void applySettings();
  });

  return {
    broker,
    desk,
    secrets,
    config,
    cache,
    home,
    locations: {
      [AppLocation.Data]: app.getPath("userData"),
      [AppLocation.Config]: config.file,
    },
    applySettings,
    theme,
    applyTheme,
    marketData,
    liveCandles,
    userData,
  };
}

export type Services = ReturnType<typeof createServices>;
