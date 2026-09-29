import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { openFubonSession } from "@solyx/brokers/fubon";
import type { FubonSession } from "@solyx/brokers/fubon";
import { Market } from "@solyx/core/market";
import { openCache } from "@solyx/db/cache";

import { FubonFile, MarketDataSource, Secret } from "#shared/ipc/settings.ts";

import { createMarketDataSources } from "../src/main/modules/market/market-data-sources.ts";
import { createConfigFile } from "../src/main/modules/settings/config-file.ts";
import { createSecretStore } from "../src/main/modules/settings/secret-store.ts";

vi.mock("@solyx/brokers/fubon", () => ({ openFubonSession: vi.fn() }));

const MIGRATIONS = join(
  import.meta.dirname,
  "../../../packages/db/migrations/cache"
);

function fakeSession(): FubonSession {
  return {
    accounts: [
      { name: "Test", branchNo: "6460", account: "28", accountType: "stock" },
    ],
    realtime: () => ({
      sdkToken: "sdk-token",
      restBaseUrl: "https://rest.example.test/marketdata",
      streamBaseUrl: "wss://stream.example.test/marketdata",
    }),
    close: vi.fn(),
  };
}

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-sources-"));
  vi.mocked(openFubonSession).mockReset();
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
  vi.mocked(openFubonSession).mockImplementation(fakeSession);

  const { secrets, sources, useFubon } = setup();

  await useFubon();

  expect((await sources.status()).markets[Market.TW]).toEqual({
    source: MarketDataSource.Fubon,
    ready: true,
  });
  expect((await sources.provider(Market.TW))?.id).toBe("fubon");

  await sources.provider(Market.TW);
  await sources.openStream();

  expect(openFubonSession).toHaveBeenCalledTimes(1);
  expect(openFubonSession).toHaveBeenCalledWith({
    sdkDir: "/sdk",
    logDir: join(directory, "fubon"),
    credentials: {
      personalId: "A123456789",
      apiKey: "fubon-key",
      certPath: "/cert.pfx",
      certPassword: undefined,
    },
  });

  const [first] = vi.mocked(openFubonSession).mock.results;

  await secrets.save(Secret.FubonApiKey, "another-key");
  await sources.provider(Market.TW);

  expect(openFubonSession).toHaveBeenCalledTimes(2);
  expect(first.value.close).toHaveBeenCalled();
});

test("a failed Fubon sign-in is not retried until the user asks", async () => {
  vi.mocked(openFubonSession).mockImplementation(() => {
    throw new Error("Fubon login failed: API key rejected");
  });

  const { sources, useFubon } = setup();

  await useFubon();

  await expect(sources.provider(Market.TW)).rejects.toThrow("API key rejected");
  await expect(sources.provider(Market.TW)).rejects.toThrow("API key rejected");
  expect(await sources.openStream()).toBeUndefined();
  expect(openFubonSession).toHaveBeenCalledTimes(1);

  vi.mocked(openFubonSession).mockImplementation(fakeSession);

  expect(await sources.signInFubon()).toBe(1);
  expect(openFubonSession).toHaveBeenCalledTimes(2);
});

test("switching Taiwan back to Fugle signs out of Fubon", async () => {
  vi.mocked(openFubonSession).mockImplementation(fakeSession);

  const { config, sources, useFubon } = setup();

  await useFubon();
  await sources.provider(Market.TW);
  config.set(["marketData", Market.TW], MarketDataSource.Fugle);
  await sources.provider(Market.TW);

  const [session] = vi.mocked(openFubonSession).mock.results;

  expect(session.value.close).toHaveBeenCalled();
});
