import { createRequire } from "node:module";

import { BrokerMode } from "@solyx/core/broker";
import type { BrokerAdapter } from "@solyx/core/broker";
import { Market } from "@solyx/core/market";

interface FubonResult<T> {
  isSuccess: boolean;
  data?: T;
  message?: string;
}

/** The slice of the official `fubon-neo` Node SDK this adapter touches so far. */
interface FubonSdk {
  login(
    personalId: string,
    password: string,
    certPath: string,
    certPassword?: string
  ): FubonResult<unknown[]>;
  logout(): boolean;
}

interface FubonSdkModule {
  FubonSDK: new () => FubonSdk;
}

/**
 * `fubon-neo` is downloaded by each user from Fubon and may not be redistributed, so it is never
 * a package dependency. The user extracts it and points the app at the folder.
 */
export function loadFubonSdk(sdkDir: string): FubonSdkModule {
  // SAFETY: `sdkDir` is the user's extracted copy of the official `fubon-neo` package, whose
  // entry exports `FubonSDK`; a wrong folder fails at `login` before any order can be placed.
  return createRequire(import.meta.url)(sdkDir) as FubonSdkModule;
}

export interface FubonCredentials {
  personalId: string;
  password: string;
  /** The `.pfx` issued to the user; it stays on their machine. */
  certPath: string;
  certPassword?: string;
}

export interface FubonBrokerOptions {
  sdkDir: string;
  credentials: FubonCredentials;
}

export interface FubonBroker extends BrokerAdapter {
  connect(): void;
  disconnect(): void;
}

export function createFubonBroker(options: FubonBrokerOptions): FubonBroker {
  let sdk: FubonSdk | undefined;

  // Trading calls stay unimplemented until they are verified against Fubon's test environment.
  const notVerified = (what: string) =>
    new Error(
      `Fubon ${what} is not implemented yet: verify the SDK responses in Fubon's test environment first`
    );

  return {
    id: "fubon",
    mode: BrokerMode.Live,
    markets: [Market.TW],

    connect() {
      const { FubonSDK } = loadFubonSdk(options.sdkDir);
      const client = new FubonSDK();

      const { personalId, password, certPath, certPassword } =
        options.credentials;

      const result = client.login(personalId, password, certPath, certPassword);

      if (!result.isSuccess || !result.data?.length) {
        throw new Error(
          `Fubon login failed: ${result.message ?? "unknown error"}`
        );
      }

      sdk = client;
    },

    disconnect() {
      sdk?.logout();
      sdk = undefined;
    },

    async getAccount() {
      throw notVerified("account queries");
    },

    async placeOrder() {
      throw notVerified("order placement");
    },

    async cancelOrder() {
      throw notVerified("order cancellation");
    },
  };
}
