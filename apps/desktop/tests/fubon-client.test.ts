import { MessageChannel } from "node:worker_threads";

import { MemoryPublisher } from "@orpc/publisher/memory";
import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import type {
  FubonAccount,
  FubonRealtime,
  FubonSessionOptions,
} from "@solyx/brokers/fubon";

import { connectFubon } from "../src/main/modules/market/fubon-client.ts";
import { keepMessages } from "../src/main/rpc/messages.ts";
import type { Change } from "../src/shared/rpc/changes.ts";
import { fubonContract } from "../src/utility/fubon.contract.ts";

const OPTIONS = {
  sdkDir: "/sdk",
  logDir: "/logs",
  credentials: {
    personalId: "A123456789",
    apiKey: "fubon-key",
    certPath: "/cert.pfx",
    certPassword: undefined,
  },
};

const ACCOUNTS = [
  { name: "Test", branchNo: "6460", account: "28", accountType: "stock" },
];

const REALTIME = {
  sdkToken: "sdk-token",
  restBaseUrl: "https://rest.example.test/marketdata",
  streamBaseUrl: "wss://stream.example.test/marketdata",
};

/** What the test's Fubon SDK does for each call, as the utility process would serve it. */
interface FakeSdk {
  open(options: FubonSessionOptions): Promise<FubonAccount[]>;
  realtime(): Promise<FubonRealtime>;
  close(): Promise<void>;
}

const never = () => new Promise<never>(() => undefined);

/** A utility process serving `sdk` over a channel, as `utility/fubon.ts` does. */
function fakeChild(sdk: Partial<FakeSdk> = {}) {
  const { port1, port2 } = new MessageChannel();
  const fubon = implement(fubonContract);
  const opened: FubonSessionOptions[] = [];
  const exits: ((code: number) => void)[] = [];
  const kill = vi.fn();
  const reports = new MemoryPublisher<{ changed: Change }>();
  const streams = { opened: 0 };

  const handler = new RPCHandler(
    fubon.router({
      open: fubon.open.handler(({ input }) => {
        opened.push(input);

        return sdk.open ? sdk.open(input) : Promise.resolve(ACCOUNTS);
      }),
      realtime: fubon.realtime.handler(() =>
        sdk.realtime ? sdk.realtime() : Promise.resolve(REALTIME)
      ),
      holdings: fubon.holdings.handler(() => ({
        inventories: [],
        unrealized: [],
        bank: { availableBalance: 0 },
        settlements: [],
      })),
      orders: fubon.orders.handler(() => []),
      fills: fubon.fills.handler(() => []),
      place: fubon.place.handler(() => Promise.reject(new Error("unused"))),
      cancel: fubon.cancel.handler(() => undefined),
      placeCondition: fubon.placeCondition.handler(() => ({ guid: "G-1" })),
      conditions: fubon.conditions.handler(() => []),
      cancelCondition: fubon.cancelCondition.handler(() => undefined),
      changes: fubon.changes.handler(({ signal }) => {
        streams.opened += 1;

        return reports.subscribe("changed", { signal });
      }),
      close: fubon.close.handler(() =>
        sdk.close ? sdk.close() : Promise.resolve()
      ),
    }),
    { clientInterceptors: [keepMessages] }
  );

  handler.upgrade(port2);
  port2.start();
  port1.start();

  const child = {
    on(_event: "exit", listener: (code: number) => void) {
      exits.push(listener);
    },
    kill,
  };

  const exit = (code: number) => {
    for (const listener of exits) listener(code);
  };

  const connect = (answerTimeoutMs?: number) =>
    connectFubon(child, port1, OPTIONS, answerTimeoutMs);

  // Fubon telling of an order of the account changing.
  const report = () => reports.publish("changed", {});

  return { connect, opened, exit, kill, report, streams };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

test("a session signs in with the options, then answers each call", async () => {
  const tokens = ["first", "second"];

  const { connect, opened, kill } = fakeChild({
    realtime: async () => ({ ...REALTIME, sdkToken: tokens.shift() ?? "" }),
  });

  const session = await connect();

  expect(opened).toEqual([OPTIONS]);
  expect(session.accounts).toEqual(ACCOUNTS);

  const [first, second] = await Promise.all([
    session.realtime(),
    session.realtime(),
  ]);

  expect([first.sdkToken, second.sdkToken].toSorted()).toEqual([
    "first",
    "second",
  ]);
  expect(kill).not.toHaveBeenCalled();
});

test("each report Fubon tells of reaches the session's listener", async () => {
  const { connect, report, streams } = fakeChild();
  const session = await connect();
  const listener = vi.fn();

  session.watch(listener);

  // The stream opens over the port before a report can reach it.
  await vi.waitFor(() => expect(streams.opened).toBe(1));
  await report();
  await report();

  await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
});

test("a failed sign-in ends the process and tells Fubon's reason", async () => {
  const { connect, kill } = fakeChild({
    open: async () => {
      throw new Error("Fubon login failed: API key rejected");
    },
  });

  await expect(connect()).rejects.toThrow("API key rejected");
  expect(kill).toHaveBeenCalled();
});

test("a call Fubon does not answer in time ends the process, failing it and every later call", async () => {
  const { connect, kill } = fakeChild({ realtime: never });
  const session = await connect(1000);
  const stalled = session.realtime();

  vi.advanceTimersByTime(1000);

  await expect(stalled).rejects.toThrow("did not answer within 1 seconds");
  expect(kill).toHaveBeenCalled();
  await expect(session.realtime()).rejects.toThrow("did not answer");
});

test("a process that exits fails every call still waiting", async () => {
  const { connect, exit } = fakeChild({ realtime: never });
  const session = await connect();
  const waiting = session.realtime();

  exit(1);

  await expect(waiting).rejects.toThrow("exited with code 1");
});

test("closing signs out, and ends the process even when signing out stalls", async () => {
  let signingOut = false;

  const { connect, kill } = fakeChild({
    close: () => {
      signingOut = true;

      return never();
    },
  });

  const session = await connect(1000);

  session.close();

  await vi.waitFor(() => expect(signingOut).toBe(true));
  expect(kill).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(1000);

  expect(kill).toHaveBeenCalled();
});
