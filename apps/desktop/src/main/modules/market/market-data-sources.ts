import { isEqual } from "es-toolkit";

import type { FubonRealtime, FubonSessionOptions } from "@solyx/brokers/fubon";
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
import {
  FUGLE_PLANS,
  createFugleMarketData,
  createFugleStream,
} from "@solyx/market-data/fugle";
import type { FuglePlan } from "@solyx/market-data/fugle";
import { errorMessage } from "@solyx/utils/error";

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

import type { FubonProcess } from "./fubon-process.ts";

interface FubonConnection {
  session: FubonProcess;
  realtime: FubonRealtime;
  provider: MarketDataProvider;
}

type FubonOutcome = { connection: FubonConnection } | { failure: unknown };

/** The last sign-in, for the settings it used; a failure is kept so it is not retried unasked. */
interface FubonSignIn {
  options: FubonSessionOptions;
  /** Settles once Fubon answers, and never rejects. */
  outcome: Promise<FubonOutcome>;
  settled: boolean;
}

interface MarketDataSourcesOptions {
  config: ConfigFile;
  secrets: SecretStore;
  candles: CandleStore;
  /** A private folder for the Fubon SDK's logs, which hold the ID number and account details. */
  fubonLogDir: string;
  openFubonProcess: (options: FubonSessionOptions) => Promise<FubonProcess>;
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
  openFubonProcess,
}: MarketDataSourcesOptions) {
  let fugle:
    | { apiKey: string; plan: FuglePlan; provider: MarketDataProvider }
    | undefined;

  let fubon: FubonSignIn | undefined;

  const twSource = () => config.read().marketData.TW;

  const fuglePlan = () => config.read().providers.fugle.plan;

  function fubonFiles(): Record<FubonFile, string | null> {
    const { sdk, certificate } = config.read().providers.fubon;

    return { sdk: sdk ?? null, certificate: certificate ?? null };
  }

  /** Everything Fubon signs in with, or `undefined` until all of it is saved. */
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

  async function signIn(
    options: FubonSessionOptions
  ): Promise<FubonConnection> {
    const session = await openFubonProcess(options);

    try {
      const realtime = await session.realtime();

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

  function startSignIn(options: FubonSessionOptions): FubonSignIn {
    const current: FubonSignIn = {
      options,
      outcome: signIn(options).then(
        (connection) => ({ connection }),
        (cause: unknown) => ({ failure: cause })
      ),
      settled: false,
    };

    void current.outcome.then(() => {
      current.settled = true;
    });

    return current;
  }

  function signOutFubon() {
    // A sign-in still waiting for Fubon signs out once it answers.
    void fubon?.outcome.then((outcome) => {
      if ("connection" in outcome) outcome.connection.session.close();
    });

    fubon = undefined;
  }

  // Repeated failures could lock the account, so signing in happens once per settings unless the
  // user asks again.
  async function fubonConnection(
    retry = false
  ): Promise<FubonConnection | undefined> {
    const options = await fubonSettings();

    if (!options) {
      signOutFubon();

      return undefined;
    }

    if (retry || !fubon || !isEqual(fubon.options, options)) {
      signOutFubon();
      fubon = startSignIn(options);
    }

    const outcome = await fubon.outcome;

    if ("failure" in outcome) throw outcome.failure;

    return outcome.connection;
  }

  // Reports without signing in, but waits for a sign-in Fubon has yet to answer.
  async function fubonSession(
    options: FubonSessionOptions | undefined
  ): Promise<FubonSessionStatus> {
    // A sign-in with other settings no longer says anything about these.
    if (!fubon || !options || !isEqual(fubon.options, options)) {
      return { state: FubonSessionState.SignedOut };
    }

    const outcome = await fubon.outcome;

    return "connection" in outcome
      ? {
          state: FubonSessionState.SignedIn,
          accounts: outcome.connection.session.accounts.length,
        }
      : {
          state: FubonSessionState.Failed,
          message: errorMessage(outcome.failure),
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
    streamSettings: () => [twSource(), fuglePlan(), fubonFiles()],

    async status(): Promise<MarketDataStatus> {
      const source = twSource();
      const fubonOptions = await fubonSettings();

      const ready =
        source === MarketDataSource.Fubon
          ? fubonOptions !== undefined
          : (await secrets.state(Secret.FugleApiKey)) === SecretState.Saved;

      return {
        markets: { [Market.TW]: { source, ready }, [Market.US]: null },
        fugle: { plan: fuglePlan(), plans: Object.values(FUGLE_PLANS) },
        fubon: {
          plan: FUBON_PLAN,
          files: fubonFiles(),
          session: await fubonSession(fubonOptions),
        },
      };
    },

    /** Signs in again with the saved settings, even after a failure. */
    async signInFubon(): Promise<void> {
      // Asking while Fubon has yet to answer waits for that answer rather than signing in twice.
      const connection = await fubonConnection(fubon?.settled !== false);

      if (!connection) {
        throw new Error(
          "Choose the SDK folder and certificate, and save your ID number and API key first"
        );
      }
    },
  };
}
