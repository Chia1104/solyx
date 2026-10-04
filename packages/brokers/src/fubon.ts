import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import * as z from "zod";

import { BrokerMode } from "@solyx/core/broker";
import type { BrokerAdapter } from "@solyx/core/broker";
import { Market } from "@solyx/core/market";

interface FubonResult<T> {
  isSuccess: boolean;
  data?: T;
  message?: string;
}

export interface FubonAccount {
  name: string;
  branchNo: string;
  account: string;
  accountType: string;
}

/** The slice of the SDK's native `CoreSdk` this module touches so far. */
interface FubonCoreSdk {
  apikeyLogin(
    personalId: string,
    apiKey: string,
    certPath: string,
    certPassword?: string
  ): FubonResult<FubonAccount[]>;
  logout(): boolean;
  exchangeRealtimeToken(): string;
  /** Called after the token exchange, which may suggest the endpoint. */
  realtimeWsUrl(mode: "normal" | "speed"): string;
}

interface FubonBinding {
  CoreSdk: new (version: string) => FubonCoreSdk;
  FugleRealtime: new () => { readonly realtimeRestUrl: string };
}

// The package's entry needs npm dependencies an extracted download lacks, only to add market
// data clients for Fugle's API, which `@solyx/market-data/fubon` calls directly.
const BINDING = "trade.js";

const manifestSchema = z.object({ version: z.string() });

/**
 * `fubon-neo` is downloaded by each user from Fubon and may not be redistributed, so it is never
 * a package dependency. The user extracts it and chooses that folder or the `package` folder
 * inside it.
 */
function loadFubonSdk(dir: string) {
  const sdkDir = [dir, join(dir, "package")].find((candidate) =>
    existsSync(join(candidate, BINDING))
  );

  if (!sdkDir) {
    throw new Error(
      `No Fubon Neo SDK in ${dir}: choose the folder extracted from fubon-neo-<version>.tgz`
    );
  }

  const { version } = manifestSchema.parse(
    JSON.parse(readFileSync(join(sdkDir, "package.json"), "utf8"))
  );

  // SAFETY: `sdkDir` holds the user's copy of the official `fubon-neo` package, whose native
  // binding exports these classes; a wrong folder fails at login, before any order is placed.
  const binding = createRequire(import.meta.url)(
    join(sdkDir, BINDING)
  ) as FubonBinding;

  return { ...binding, version };
}

export interface FubonCredentials {
  /** The ID number the account was opened under. */
  personalId: string;
  /** A key from Fubon's API key page; one limited to market data cannot place orders. */
  apiKey: string;
  /** The certificate exported from Fubon's website; it stays on the user's machine. */
  certPath: string;
  /** @default personalId, which Fubon sets for exported certificates */
  certPassword?: string;
}

export interface FubonSessionOptions {
  sdkDir: string;
  /** Where the SDK writes its logs, which hold the ID number and account details. */
  logDir: string;
  credentials: FubonCredentials;
}

/** A market data token and the endpoints that take it; the stream is Normal mode's, the one with candles. */
export interface FubonRealtime {
  sdkToken: string;
  /** Host and path prefix, as the SDK reports them. */
  restBaseUrl: string;
  streamBaseUrl: string;
}

export interface FubonSession {
  accounts: FubonAccount[];
  /** Exchanges the session for a market data token. */
  realtime(): FubonRealtime;
  close(): void;
}

/**
 * Signs in with an API key. The SDK's calls are synchronous and block until Fubon answers, it
 * connects to Fubon as soon as it is created, and it moves the process to `logDir`, so callers
 * run it in a process of its own.
 */
export function openFubonSession(options: FubonSessionOptions): FubonSession {
  const { CoreSdk, FugleRealtime, version } = loadFubonSdk(options.sdkDir);

  // The SDK logs to `./log` and has no setting for it, so the process works from `logDir`.
  mkdirSync(options.logDir, { recursive: true });
  process.chdir(options.logDir);

  const sdk = new CoreSdk(version);
  const { personalId, apiKey, certPath, certPassword } = options.credentials;
  const result = sdk.apikeyLogin(personalId, apiKey, certPath, certPassword);

  if (!result.isSuccess || !result.data?.length) {
    throw new Error(`Fubon login failed: ${result.message ?? "no accounts"}`);
  }

  return {
    accounts: result.data,

    realtime() {
      const sdkToken = sdk.exchangeRealtimeToken();

      return {
        sdkToken,
        restBaseUrl: new FugleRealtime().realtimeRestUrl,
        streamBaseUrl: sdk.realtimeWsUrl("normal"),
      };
    },

    close() {
      sdk.logout();
    },
  };
}

/**
 * Never signs in itself: the SDK runs only in a process of its own, and market data and trading
 * share one sign-in, since repeated sign-ins could lock the account.
 */
export function createFubonBroker(): BrokerAdapter {
  // Trading calls stay unimplemented until they are verified against Fubon's test environment.
  const notVerified = (what: string) =>
    new Error(
      `Fubon ${what} is not implemented yet: verify the SDK responses in Fubon's test environment first`
    );

  return {
    id: "fubon",
    mode: BrokerMode.Live,
    markets: [Market.TW],

    async getAccount() {
      throw notVerified("account queries");
    },

    async placeOrder() {
      throw notVerified("order placement");
    },
  };
}
