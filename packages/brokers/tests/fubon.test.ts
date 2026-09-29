import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import * as z from "zod";

import { openFubonSession } from "../src/fubon.ts";

// Stands in for the SDK's native binding; it records calls on the module so tests can read them.
const FAKE_BINDING = `
const calls = [];

class CoreSdk {
  constructor(version) {
    calls.push(["new", version]);
  }

  apikeyLogin(...args) {
    calls.push(["apikeyLogin", ...args]);

    return args[1] === "good-key"
      ? { isSuccess: true, data: [{ name: "Test", branchNo: "6460", account: "28", accountType: "stock" }] }
      : { isSuccess: false, message: "API key rejected" };
  }

  logout() {
    calls.push(["logout"]);

    return true;
  }

  exchangeRealtimeToken() {
    return "sdk-token";
  }

  realtimeWsUrl(mode) {
    return "wss://" + mode + ".example.test/marketdata";
  }
}

class FugleRealtime {
  get realtimeRestUrl() {
    return "https://rest.example.test/marketdata";
  }
}

module.exports = { CoreSdk, FugleRealtime, calls };
`;

let directory: string;

let workingDirectory: string;

beforeEach(async () => {
  workingDirectory = process.cwd();
  directory = await mkdtemp(join(tmpdir(), "solyx-fubon-"));

  // Extracting fubon-neo-<version>.tgz creates a `package` folder.
  const sdk = join(directory, "package");

  await mkdir(sdk);
  await writeFile(join(sdk, "trade.js"), FAKE_BINDING);
  await writeFile(
    join(sdk, "package.json"),
    JSON.stringify({ name: "fubon-neo", version: "2.3.0" })
  );
});

afterEach(async () => {
  process.chdir(workingDirectory);
  await rm(directory, { recursive: true, force: true });
});

const options = (apiKey: string, sdkDir = directory) => ({
  sdkDir,
  logDir: join(directory, "logs"),
  credentials: {
    personalId: "A123456789",
    apiKey,
    certPath: "/certs/A123456789.pfx",
  },
});

test("signs in with an API key and exchanges a token for Normal-mode market data", async () => {
  const session = openFubonSession(options("good-key"));

  expect(session.accounts).toHaveLength(1);
  expect(session.realtime()).toEqual({
    sdkToken: "sdk-token",
    restBaseUrl: "https://rest.example.test/marketdata",
    streamBaseUrl: "wss://normal.example.test/marketdata",
  });

  session.close();

  // The SDK writes ./log under the working directory, which holds the ID number.
  expect(process.cwd()).toBe(await realpath(join(directory, "logs")));

  const { calls } = z
    .object({ calls: z.array(z.array(z.unknown())) })
    .parse(
      createRequire(import.meta.url)(join(directory, "package", "trade.js"))
    );

  expect(calls).toEqual([
    ["new", "2.3.0"],
    [
      "apikeyLogin",
      "A123456789",
      "good-key",
      "/certs/A123456789.pfx",
      undefined,
    ],
    ["logout"],
  ]);
});

test("a refused sign-in reports Fubon's message", () => {
  expect(() => openFubonSession(options("bad-key"))).toThrow(
    "Fubon login failed: API key rejected"
  );
});

test("a folder without the SDK says so", () => {
  expect(() =>
    openFubonSession(options("good-key", join(directory, "elsewhere")))
  ).toThrow(/No Fubon Neo SDK/);
});
