import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import type { FubonSessionOptions } from "@solyx/brokers/fubon";
import { Market } from "@solyx/core/market";
import { openCache } from "@solyx/db/cache";

import {
  FubonFile,
  FubonSessionState,
  MarketDataSource,
  Secret,
} from "#shared/ipc/settings.ts";

import type { FubonProcess } from "../src/main/modules/market/fubon-process.ts";
import { createMarketDataSources } from "../src/main/modules/market/market-data-sources.ts";
import { createConfigFile } from "../src/main/modules/settings/config-file.ts";
import { createSecretStore } from "../src/main/modules/settings/secret-store.ts";

const MIGRATIONS = join(
  import.meta.dirname,
  "../../../packages/db/migrations/cache"
);

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

function setup() {
  const config = createConfigFile(join(directory, ".solyx", "config.jsonc"));

  config.create();

  const secrets = createSecretStore(join(directory, "secrets.json"), {
    isAvailable: async () => true,
    encrypt: async (plainText) => Buffer.from(plainText),
    decrypt: async (encrypted) => ({
      plainText: encrypted.toString(),
      shouldReEncrypt: false,
    }),
  });

  const sources = createMarketDataSources({
    config,
    secrets,
    candles: openCache(":memory:", MIGRATIONS).candles,
    fubonLogDir: join(directory, "fubon"),
    openFubonProcess,
  });

  // Everything Fubon signs in with, and Fubon as Taiwan's source.
  async function useFubon() {
    config.set(["marketData", Market.TW], MarketDataSource.Fubon);
    config.set(["providers", "fubon", FubonFile.Sdk], "/sdk");
    config.set(["providers", "fubon", FubonFile.Certificate], "/cert.pfx");
    await secrets.save(Secret.FubonPersonalId, "A123456789");
    await secrets.save(Secret.FubonApiKey, "fubon-key");
  }

  return { config, secrets, sources, useFubon };
}

test("Taiwan charts come from Fugle by default, once its key is saved", async () => {
  const { secrets, sources } = setup();

  expect((await sources.status()).markets).toEqual({
    [Market.TW]: { source: MarketDataSource.Fugle, ready: false },
    [Market.US]: null,
  });
  expect(await sources.provider(Market.TW)).toBeUndefined();

  await secrets.save(Secret.FugleApiKey, "fugle-key");

  expect((await sources.status()).markets[Market.TW]?.ready).toBe(true);
  expect((await sources.provider(Market.TW))?.id).toBe("fugle");
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
