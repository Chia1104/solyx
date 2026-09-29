import * as z from "zod";

import { openFubonSession } from "@solyx/brokers/fubon";
import type { FubonSession, FubonSessionOptions } from "@solyx/brokers/fubon";
import { Market } from "@solyx/core/market";
import type {
  MarketDataProvider,
  MarketDataStream,
} from "@solyx/core/market-data";
import type { CandleStore } from "@solyx/db/cache";
import { withCandleCache } from "@solyx/market-data/candle-cache";
import {
  FUBON_PLAN,
  createFubonMarketData,
  createFubonStream,
} from "@solyx/market-data/fubon";
import type { FubonRealtime } from "@solyx/market-data/fubon";
import {
  FUGLE_PLANS,
  FuglePlan,
  createFugleMarketData,
  createFugleStream,
  fuglePlanSchema,
} from "@solyx/market-data/fugle";

import {
  FubonSessionState,
  MarketDataSource,
  Secret,
  SecretState,
} from "#shared/ipc/settings.ts";
import type {
  FubonFile,
  FubonSessionStatus,
  MarketDataStatus,
} from "#shared/ipc/settings.ts";

import type { ConfigFile } from "../settings/config-file.ts";
import type { SecretStore } from "../settings/secret-store.ts";

const marketDataSourceSchema = z.enum(MarketDataSource);

interface FubonConnection {
  session: FubonSession;
  realtime: FubonRealtime;
  provider: MarketDataProvider;
}

/** The last sign-in, for the settings it used; a failure is kept so it is not retried unasked. */
type FubonSignIn = { settings: string } & (
  | { connection: FubonConnection }
  | { failure: unknown }
);

export interface MarketDataSourcesOptions {
  config: ConfigFile;
  secrets: SecretStore;
  candles: CandleStore;
  /** A private folder for the Fubon SDK's logs, which hold the ID number and account details. */
  fubonLogDir: string;
}

/**
 * The provider and stream behind each market's charts, as the user's settings pick them. Keeps
 * one provider per credential and plan, so request budgets hold across requests, and one Fubon
 * session, signed in on first use.
 */
export function createMarketDataSources({
  config,
  secrets,
  candles,
  fubonLogDir,
}: MarketDataSourcesOptions) {
  let fugle:
    | { apiKey: string; plan: FuglePlan; provider: MarketDataProvider }
    | undefined;

  let fubon: FubonSignIn | undefined;

  // A value this build does not know, from a hand edit or another build, reads as the default.
  const twSource = () =>
    marketDataSourceSchema
      .catch(MarketDataSource.Fugle)
      .parse(config.read().marketData?.TW);

  const fuglePlan = () =>
    fuglePlanSchema
      .catch(FuglePlan.Basic)
      .parse(config.read().providers?.fugle?.plan);

  function fubonFiles(): Record<FubonFile, string | null> {
    const saved = config.read().providers?.fubon;

    return { sdk: saved?.sdk ?? null, certificate: saved?.certificate ?? null };
  }

  async function fubonSettings(): Promise<FubonSessionOptions | undefined> {
    const { sdk, certificate } = fubonFiles();

    const [personalId, apiKey, certPassword] = await Promise.all([
      secrets.get(Secret.FubonPersonalId),
      secrets.get(Secret.FubonApiKey),
      secrets.get(Secret.FubonCertPassword),
    ]);

    if (!sdk || !certificate || !personalId || !apiKey) return undefined;

    return {
      sdkDir: sdk,
      logDir: fubonLogDir,
      credentials: { personalId, apiKey, certPath: certificate, certPassword },
    };
  }

  function signIn(options: FubonSessionOptions): FubonConnection {
    const session = openFubonSession(options);

    try {
      const realtime = session.realtime();

      return {
        session,
        realtime,
        provider: withCandleCache(createFubonMarketData({ realtime }), candles),
      };
    } catch (error) {
      session.close();
      throw error;
    }
  }

  function signOutFubon() {
    if (fubon && "connection" in fubon) fubon.connection.session.close();

    fubon = undefined;
  }

  // Signing in blocks until Fubon answers, and repeated failures could lock the account, so it
  // happens once per settings unless the user asks again.
  async function fubonConnection(
    retry = false
  ): Promise<FubonConnection | undefined> {
    const options = await fubonSettings();

    if (!options) {
      signOutFubon();

      return undefined;
    }

    const settings = JSON.stringify(options);
    let current = fubon;

    if (retry || current?.settings !== settings) {
      signOutFubon();

      try {
        current = { settings, connection: signIn(options) };
      } catch (failure) {
        current = { settings, failure };
      }

      fubon = current;
    }

    if ("failure" in current) throw current.failure;

    return current.connection;
  }

  // Reports without signing in: that blocks until Fubon answers.
  async function fubonSession(): Promise<FubonSessionStatus> {
    const options = await fubonSettings();

    // A sign-in with other settings no longer says anything about these.
    if (!fubon || !options || fubon.settings !== JSON.stringify(options)) {
      return { state: FubonSessionState.SignedOut };
    }

    return "connection" in fubon
      ? {
          state: FubonSessionState.SignedIn,
          accounts: fubon.connection.session.accounts.length,
        }
      : {
          state: FubonSessionState.Failed,
          message:
            fubon.failure instanceof Error
              ? fubon.failure.message
              : String(fubon.failure),
        };
  }

  async function fugleProvider(): Promise<MarketDataProvider | undefined> {
    const apiKey = await secrets.get(Secret.FugleApiKey);

    if (apiKey === undefined) return undefined;

    const plan = fuglePlan();

    if (fugle?.apiKey !== apiKey || fugle.plan !== plan) {
      fugle = {
        apiKey,
        plan,
        provider: withCandleCache(
          createFugleMarketData({ apiKey, plan }),
          candles
        ),
      };
    }

    return fugle.provider;
  }

  return {
    /** The market's provider, or `undefined` when none covers it or its settings are incomplete. */
    async provider(market: Market): Promise<MarketDataProvider | undefined> {
      if (market !== Market.TW) return undefined;

      if (twSource() === MarketDataSource.Fubon) {
        return (await fubonConnection())?.provider;
      }

      signOutFubon();

      return fugleProvider();
    },

    /** The stream for Taiwan listings; a failed Fubon sign-in shows where charts load instead. */
    async openStream(): Promise<MarketDataStream | undefined> {
      if (twSource() === MarketDataSource.Fubon) {
        const connection = await fubonConnection().catch(() => undefined);

        return (
          connection && createFubonStream({ realtime: connection.realtime })
        );
      }

      const apiKey = await secrets.get(Secret.FugleApiKey);

      return apiKey === undefined
        ? undefined
        : createFugleStream({ apiKey, plan: fuglePlan() });
    },

    /** What the live stream depends on in the config file, to reopen it when that changes. */
    streamSettings: () =>
      JSON.stringify([twSource(), fuglePlan(), fubonFiles()]),

    async status(): Promise<MarketDataStatus> {
      const states = await secrets.states();
      const saved = (secret: Secret) => states[secret] === SecretState.Saved;
      const source = twSource();
      const files = fubonFiles();

      const ready =
        source === MarketDataSource.Fubon
          ? Boolean(files.sdk && files.certificate) &&
            saved(Secret.FubonPersonalId) &&
            saved(Secret.FubonApiKey)
          : saved(Secret.FugleApiKey);

      return {
        markets: { [Market.TW]: { source, ready }, [Market.US]: null },
        fugle: { plan: fuglePlan(), plans: Object.values(FUGLE_PLANS) },
        fubon: { plan: FUBON_PLAN, files, session: await fubonSession() },
      };
    },

    /** Signs in again with the saved settings, even after a failure. */
    async signInFubon(): Promise<void> {
      const connection = await fubonConnection(true);

      if (!connection) {
        throw new Error(
          "Choose the SDK folder and certificate, and save your ID number and API key first"
        );
      }
    },
  };
}

export type MarketDataSources = ReturnType<typeof createMarketDataSources>;
