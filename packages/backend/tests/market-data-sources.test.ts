import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import {
  FubonFile,
  FubonSessionState,
  LONGBRIDGE_SIGN_IN_SECRET,
  MarketDataSource,
  Secret,
  agentKeySecret,
} from "@solyx/api/settings";
import { FUBON_SDK_VERSIONS } from "@solyx/brokers/fubon";
import type { FubonSessionOptions } from "@solyx/brokers/fubon";
import { Market } from "@solyx/core/market";
import { weekdays } from "@solyx/core/session";
import { openCache } from "@solyx/db/cache";
import { FuglePlan } from "@solyx/market-data/fugle";
import { DAY_MS } from "@solyx/utils/date";

import type { FubonProcess } from "../src/modules/market/fubon-client.ts";
import { createLongbridgeAccess } from "../src/modules/market/longbridge-access.ts";
import { createMarketDataSources } from "../src/modules/market/market-data-sources.ts";
import { createConfigFile } from "../src/modules/settings/config-file.ts";
import { createSecretStore } from "../src/modules/settings/secret-store.ts";

import { fakeCipher } from "./fake-cipher.ts";
import { handEdit } from "./hand-edit.ts";

const MIGRATIONS = join(import.meta.dirname, "../../db/migrations/cache");

function fakeSession(): FubonProcess {
  return {
    accounts: [
      { name: "Test", branchNo: "6460", account: "28", accountType: "stock" },
    ],
    realtime: async () => ({
      sdkToken: "sdk-token",
      restBaseUrl: "https://rest.example.test/marketdata",
      streamBaseUrl: "wss://stream.example.test/marketdata",
    }),
    holdings: async () => ({
      inventories: [],
      unrealized: [],
      bank: { availableBalance: 0 },
      settlements: [],
    }),
    orders: async () => [],
    fills: async () => [],
    place: vi.fn(),
    cancel: vi.fn(),
    placeCondition: vi.fn(),
    conditions: async () => [],
    cancelCondition: vi.fn(),
    watch: vi.fn(),
    close: vi.fn(),
  };
}

const openFubonProcess =
  vi.fn<(options: FubonSessionOptions) => Promise<FubonProcess>>();

/** A sign-in Fubon answers only once the test calls `answer`. */
function heldSignIn() {
  let answer: (session: FubonProcess) => void = () => undefined;

  const session = new Promise<FubonProcess>((resolve) => {
    answer = resolve;
  });

  return { session, answer };
}

/** The session the nth sign-in opened, counting from 0. */
const openedSession = (n: number) => openFubonProcess.mock.results[n].value;

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-sources-"));
  openFubonProcess.mockReset();
});

afterEach(() => rm(directory, { recursive: true, force: true }));

function setup({ tradesFubon = false } = {}) {
  const configFile = join(directory, ".solyx", "config.json");
  const config = createConfigFile(configFile);

  config.create();

  const secrets = createSecretStore(
    join(directory, "secrets.json"),
    fakeCipher().cipher
  );

  const sources = createMarketDataSources({
    config,
    secrets,
    candles: openCache(":memory:", MIGRATIONS).candles,
    fubonLogDir: join(directory, "fubon"),
    openFubonProcess,
    tradesFubon,
    longbridge: createLongbridgeAccess({ secrets, openExternal: vi.fn() }),
    tradingDays: async () => weekdays,
  });

  // Everything Fubon signs in with, and Fubon as Taiwan's source.
  async function useFubon() {
    config.set(["marketData", Market.TW], MarketDataSource.Fubon);
    config.set(["providers", "fubon", FubonFile.Sdk], "/sdk");
    config.set(["providers", "fubon", FubonFile.Certificate], "/cert.pfx");
    await secrets.save(Secret.FubonPersonalId, "A123456789");
    await secrets.save(Secret.FubonApiKey, "fubon-key");
  }

  return { config, configFile, secrets, sources, useFubon };
}

test("Taiwan charts come from Fugle by default, once its key is saved", async () => {
  const { secrets, sources } = setup();

  expect((await sources.status()).markets).toEqual({
    [Market.TW]: { source: MarketDataSource.Fugle, ready: false },
    [Market.US]: { source: MarketDataSource.Longbridge, ready: false },
  });
  expect(await sources.provider(Market.TW)).toBeUndefined();

  await secrets.save(Secret.FugleApiKey, "fugle-key");

  expect((await sources.status()).markets[Market.TW].ready).toBe(true);
  expect((await sources.provider(Market.TW))?.id).toBe("fugle");
  expect(await sources.provider(Market.US)).toBeUndefined();
});

const LONGBRIDGE_SIGN_IN = {
  clientId: "client-1",
  redirectUri: "http://127.0.0.1:50000/callback/x",
  registration: null,
  accessToken: "hk_access",
  refreshToken: "hk_refresh",
  expiresAt: Date.now() + DAY_MS,
};

test("US charts and trading days come from Longbridge once signed in, on one connection per sign-in", async () => {
  const { secrets, sources } = setup();

  expect(await sources.provider(Market.US)).toBeUndefined();
  expect(await sources.longbridgeCalendar()).toBeUndefined();

  const signIn = LONGBRIDGE_SIGN_IN;

  await secrets.save(LONGBRIDGE_SIGN_IN_SECRET, JSON.stringify(signIn));

  expect((await sources.status()).markets[Market.US]).toEqual({
    source: MarketDataSource.Longbridge,
    ready: true,
  });

  const provider = await sources.provider(Market.US);

  expect(provider?.id).toBe("longbridge");
  expect((await sources.longbridgeCalendar())?.markets).toEqual([Market.US]);

  // A refresh keeps the client, and so the provider.
  await secrets.save(
    LONGBRIDGE_SIGN_IN_SECRET,
    JSON.stringify({ ...signIn, accessToken: "hk_access_2" })
  );

  expect(await sources.provider(Market.US)).toBe(provider);

  // A new sign-in opens another.
  await secrets.save(
    LONGBRIDGE_SIGN_IN_SECRET,
    JSON.stringify({ ...signIn, clientId: "client-2" })
  );

  expect(await sources.provider(Market.US)).not.toBe(provider);

  await secrets.delete(LONGBRIDGE_SIGN_IN_SECRET);

  expect(await sources.provider(Market.US)).toBeUndefined();
});

test("Fubon signs in once per settings, and again when they change", async () => {
  openFubonProcess.mockImplementation(async () => fakeSession());

  const { secrets, sources, useFubon } = setup();

  await useFubon();

  expect((await sources.status()).markets[Market.TW]).toEqual({
    source: MarketDataSource.Fubon,
    ready: true,
  });
  expect((await sources.provider(Market.TW))?.id).toBe("fubon");

  await sources.provider(Market.TW);
  await sources.openStream();

  expect(openFubonProcess).toHaveBeenCalledTimes(1);
  expect(openFubonProcess).toHaveBeenCalledWith({
    sdkDir: "/sdk",
    logDir: join(directory, "fubon"),
    credentials: {
      personalId: "A123456789",
      apiKey: "fubon-key",
      certPath: "/cert.pfx",
      certPassword: undefined,
    },
  });

  await secrets.save(Secret.FubonApiKey, "another-key");
  await sources.provider(Market.TW);

  expect(openFubonProcess).toHaveBeenCalledTimes(2);
  expect((await openedSession(0)).close).toHaveBeenCalled();
});

test("a failed Fubon sign-in is not retried until the user asks", async () => {
  openFubonProcess.mockRejectedValue(
    new Error("Fubon login failed: API key rejected")
  );

  const { sources, useFubon } = setup();

  await useFubon();

  await expect(sources.provider(Market.TW)).rejects.toThrow("API key rejected");
  await expect(sources.provider(Market.TW)).rejects.toThrow("API key rejected");
  expect(await sources.openStream()).toBeUndefined();
  expect(openFubonProcess).toHaveBeenCalledTimes(1);
  expect((await sources.status()).fubon.session).toEqual({
    state: FubonSessionState.Failed,
    message: "Fubon login failed: API key rejected",
  });

  openFubonProcess.mockImplementation(async () => fakeSession());

  await sources.signInFubon();

  expect(openFubonProcess).toHaveBeenCalledTimes(2);
  expect((await sources.status()).fubon.session).toEqual({
    state: FubonSessionState.SignedIn,
    accounts: 1,
    stockAccounts: [{ id: "6460-28", name: "Test" }],
  });
});

test("the Fubon session is reported without signing in, and only for the saved settings", async () => {
  openFubonProcess.mockImplementation(async () => fakeSession());

  const { secrets, sources, useFubon } = setup();

  await useFubon();

  expect((await sources.status()).fubon.session).toEqual({
    state: FubonSessionState.SignedOut,
  });
  expect(openFubonProcess).not.toHaveBeenCalled();

  await sources.provider(Market.TW);
  await secrets.save(Secret.FubonApiKey, "another-key");

  expect((await sources.status()).fubon.session).toEqual({
    state: FubonSessionState.SignedOut,
  });
});

test("switching Taiwan back to Fugle signs out of Fubon", async () => {
  openFubonProcess.mockImplementation(async () => fakeSession());

  const { config, sources, useFubon } = setup();

  await useFubon();
  await sources.provider(Market.TW);
  config.set(["marketData", Market.TW], MarketDataSource.Fugle);
  await sources.provider(Market.TW);

  expect((await openedSession(0)).close).toHaveBeenCalled();
});

test("a sign-in the user asks for while charts come from Fugle stays, so its accounts can be picked", async () => {
  openFubonProcess.mockImplementation(async () => fakeSession());

  const { config, secrets, sources, useFubon } = setup();

  await useFubon();
  config.set(["marketData", Market.TW], MarketDataSource.Fugle);
  await secrets.save(Secret.FugleApiKey, "fugle-key");

  expect((await sources.status()).fubon.ready).toBe(true);

  await sources.signInFubon();

  expect((await sources.provider(Market.TW))?.id).toBe("fugle");
  expect((await sources.status()).fubon.session).toMatchObject({
    state: FubonSessionState.SignedIn,
  });
  expect((await openedSession(0)).close).not.toHaveBeenCalled();
});

test("the chosen SDK's version reads from its folder beside the versions Solyx was checked with", async () => {
  const { config, sources } = setup();

  expect((await sources.status()).fubon).toMatchObject({
    sdkVersion: null,
    testedSdkVersions: FUBON_SDK_VERSIONS,
  });

  const sdk = join(directory, "fubon-neo", "package");

  await mkdir(sdk, { recursive: true });
  await writeFile(join(sdk, "trade.js"), "");
  await writeFile(join(sdk, "package.json"), '{ "version": "2.5.0" }');
  config.set(
    ["providers", "fubon", FubonFile.Sdk],
    join(directory, "fubon-neo")
  );

  expect((await sources.status()).fubon.sdkVersion).toBe("2.5.0");
});

test("while the desk trades with Fubon, charts from Fugle leave its session signed in and shared", async () => {
  openFubonProcess.mockImplementation(async () => fakeSession());

  const { config, sources, useFubon } = setup({ tradesFubon: true });

  await useFubon();
  await sources.provider(Market.TW);
  config.set(["marketData", Market.TW], MarketDataSource.Fugle);
  await sources.provider(Market.TW);

  expect(await sources.fubonSession()).toBe(await openedSession(0));
  expect((await openedSession(0)).close).not.toHaveBeenCalled();
  expect(openFubonProcess).toHaveBeenCalledTimes(1);
});

test("Fubon's reports reach every listener, from whichever session signed in", async () => {
  openFubonProcess.mockImplementation(async () => fakeSession());

  const { secrets, sources, useFubon } = setup({ tradesFubon: true });
  const listener = vi.fn();

  sources.onFubonChange(listener);
  await useFubon();

  const report = async (n: number) => {
    const [[told]] = vi.mocked((await openedSession(n)).watch).mock.calls;

    told?.();
  };

  await sources.fubonSession();
  await report(0);

  // Signing in again with new settings opens a session whose reports reach it too.
  await secrets.save(Secret.FubonApiKey, "new-key");
  await sources.fubonSession();
  await report(1);

  expect(listener).toHaveBeenCalledTimes(2);
});

test("the desk's session fails while Fubon's sign-in is not set up, without signing in", async () => {
  const { sources } = setup({ tradesFubon: true });

  await expect(sources.fubonSession()).rejects.toThrow(
    "Fubon's sign-in is not set up"
  );
  expect(openFubonProcess).not.toHaveBeenCalled();
});

test("charts asking while Fubon has yet to answer share one sign-in", async () => {
  const held = heldSignIn();

  openFubonProcess.mockReturnValue(held.session);

  const { sources, useFubon } = setup();

  await useFubon();

  const charts = Promise.all([
    sources.provider(Market.TW),
    sources.provider(Market.TW),
    sources.openStream(),
  ]);

  const status = sources.status();

  await vi.waitFor(() => expect(openFubonProcess).toHaveBeenCalled());

  const signIn = sources.signInFubon();

  held.answer(fakeSession());

  const [first, second, stream] = await charts;

  await signIn;

  expect(openFubonProcess).toHaveBeenCalledTimes(1);
  expect(first?.id).toBe("fubon");
  expect(second).toBe(first);
  expect(stream).toBeDefined();
  expect((await status).fubon.session).toEqual({
    state: FubonSessionState.SignedIn,
    accounts: 1,
    stockAccounts: [{ id: "6460-28", name: "Test" }],
  });
});

test("settings changed while Fubon has yet to answer sign out once it does", async () => {
  const held = heldSignIn();

  openFubonProcess.mockReturnValueOnce(held.session);
  openFubonProcess.mockImplementation(async () => fakeSession());

  const { secrets, sources, useFubon } = setup();

  await useFubon();

  const stale = sources.provider(Market.TW);

  await vi.waitFor(() => expect(openFubonProcess).toHaveBeenCalled());
  await secrets.save(Secret.FubonApiKey, "another-key");
  await sources.provider(Market.TW);

  const session = fakeSession();

  held.answer(session);
  await stale;

  expect(openFubonProcess).toHaveBeenCalledTimes(2);
  expect(session.close).toHaveBeenCalled();
  expect((await openedSession(1)).close).not.toHaveBeenCalled();
});

test("the stream changes with its own source's settings and keys, never with another's", async () => {
  const { config, secrets, sources } = setup();
  const changes = vi.fn();

  sources.onStreamChange(changes);

  await secrets.save(Secret.FugleApiKey, "fugle-key");
  config.set(["providers", "fugle", "plan"], FuglePlan.Developer);
  await secrets.save(Secret.FubonApiKey, "fubon-key");
  await secrets.save(agentKeySecret("anthropic"), "anthropic-key");
  config.set(["providers", "fubon", FubonFile.Sdk], "/sdk");

  expect(changes).toHaveBeenCalledTimes(2);

  config.set(["marketData", Market.TW], MarketDataSource.Fubon);
  config.set(["providers", "fugle", "plan"], FuglePlan.Basic);
  await secrets.save(Secret.FugleApiKey, "another-key");
  await secrets.save(Secret.FubonPersonalId, "A123456789");
  config.set(["providers", "fubon", FubonFile.Certificate], "/cert.pfx");

  expect(changes).toHaveBeenCalledTimes(5);
});

test("the stream covers each market a source covers, and none while no source does", async () => {
  const { secrets, sources } = setup();

  expect(await sources.openStream()).toBeUndefined();

  await secrets.save(
    LONGBRIDGE_SIGN_IN_SECRET,
    JSON.stringify(LONGBRIDGE_SIGN_IN)
  );

  const us = await sources.openStream();

  expect(us?.markets).toEqual([Market.US]);
  us?.close();

  await secrets.save(Secret.FugleApiKey, "fugle-key");

  const both = await sources.openStream();

  expect(both?.markets).toEqual([Market.TW, Market.US]);
  both?.close();
});

test("a Longbridge sign-in or sign-out changes the stream, while a refresh keeps it", async () => {
  const { secrets, sources } = setup();
  const changes = vi.fn();
  const told = () => new Promise((resolve) => setTimeout(resolve, 0));

  sources.onStreamChange(changes);

  await secrets.save(
    LONGBRIDGE_SIGN_IN_SECRET,
    JSON.stringify(LONGBRIDGE_SIGN_IN)
  );
  await told();

  expect(changes).toHaveBeenCalledTimes(1);

  await secrets.save(
    LONGBRIDGE_SIGN_IN_SECRET,
    JSON.stringify({ ...LONGBRIDGE_SIGN_IN, accessToken: "hk_access_2" })
  );
  await told();

  expect(changes).toHaveBeenCalledTimes(1);

  await secrets.save(
    LONGBRIDGE_SIGN_IN_SECRET,
    JSON.stringify({ ...LONGBRIDGE_SIGN_IN, clientId: "client-2" })
  );
  await told();
  await secrets.delete(LONGBRIDGE_SIGN_IN_SECRET);
  await told();

  expect(changes).toHaveBeenCalledTimes(3);
});

test("a hand edit of Taiwan's source changes the stream once", async () => {
  const { config, configFile, sources } = setup();
  const changes = vi.fn();

  sources.onStreamChange(changes);

  const stop = config.watch();

  await handEdit(
    configFile,
    '{ "marketData": { "TW": "fubon" } }',
    () => changes.mock.calls.length > 0
  );
  stop();

  expect(changes).toHaveBeenCalledTimes(1);
});

test("signing in to Fubon again changes the stream, since it keeps the session it opened with", async () => {
  openFubonProcess.mockImplementation(async () => fakeSession());

  const { sources, useFubon } = setup();
  const changes = vi.fn();

  await useFubon();
  sources.onStreamChange(changes);
  await sources.signInFubon();

  expect(changes).toHaveBeenCalledTimes(1);
});
