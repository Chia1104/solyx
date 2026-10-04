import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { connectFubon } from "../src/main/modules/market/fubon-client.ts";
import type { FubonChild } from "../src/main/modules/market/fubon-client.ts";
import { FubonMethod } from "../src/utility/fubon-protocol.ts";
import type {
  FubonReply,
  FubonRequest,
} from "../src/utility/fubon-protocol.ts";

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

/** A utility process the test answers for, as the Fubon SDK would. */
function fakeChild() {
  const requests: FubonRequest[] = [];
  const replies: ((reply: FubonReply) => void)[] = [];
  const exits: ((code: number) => void)[] = [];
  const kill = vi.fn();

  const child: FubonChild = {
    postMessage: (request) => requests.push(request),
    on(event: "message" | "exit", listener: never) {
      if (event === "message") replies.push(listener);
      else exits.push(listener);
    },
    kill,
  };

  const reply = (message: FubonReply) => {
    for (const listener of replies) listener(message);
  };

  const exit = (code: number) => {
    for (const listener of exits) listener(code);
  };

  /** Answers the sign-in, which `connectFubon` waits for. */
  async function signIn(answerTimeoutMs?: number) {
    const opened = connectFubon(child, OPTIONS, answerTimeoutMs);

    await vi.waitFor(() => expect(requests).toHaveLength(1));
    reply({ id: requests[0].id, answer: ACCOUNTS });

    return opened;
  }

  return { child, requests, reply, exit, kill, signIn };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("a session signs in with the options, then answers each call by its id", async () => {
  const { requests, reply, kill, signIn } = fakeChild();
  const session = await signIn();

  expect(requests[0]).toEqual({
    id: 0,
    method: FubonMethod.Open,
    options: OPTIONS,
  });
  expect(session.accounts).toEqual(ACCOUNTS);

  const first = session.realtime();
  const second = session.realtime();

  // Answered out of order, each reaches its own call.
  reply({ id: requests[2].id, answer: { ...REALTIME, sdkToken: "second" } });
  reply({ id: requests[1].id, answer: REALTIME });

  expect(await first).toEqual(REALTIME);
  expect((await second).sdkToken).toBe("second");
  expect(kill).not.toHaveBeenCalled();
});

test("a failed sign-in ends the process", async () => {
  const { child, requests, reply, kill } = fakeChild();
  const opened = connectFubon(child, OPTIONS);

  reply({ id: requests[0].id, error: "Fubon login failed: API key rejected" });

  await expect(opened).rejects.toThrow("API key rejected");
  expect(kill).toHaveBeenCalled();
});

test("a call Fubon does not answer in time ends the process, failing it and every later call", async () => {
  const { kill, signIn } = fakeChild();
  const session = await signIn(1000);
  const stalled = session.realtime();

  vi.advanceTimersByTime(1000);

  await expect(stalled).rejects.toThrow("did not answer within 1 seconds");
  expect(kill).toHaveBeenCalled();
  await expect(session.realtime()).rejects.toThrow("did not answer");
});

test("a process that exits fails every call still waiting", async () => {
  const { exit, signIn } = fakeChild();
  const session = await signIn();
  const waiting = session.realtime();

  exit(1);

  await expect(waiting).rejects.toThrow("exited with code 1");
});

test("closing signs out, and ends the process even when signing out stalls", async () => {
  const { requests, kill, signIn } = fakeChild();
  const session = await signIn(1000);

  session.close();

  expect(requests.at(-1)?.method).toBe(FubonMethod.Close);
  expect(kill).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(1000);

  expect(kill).toHaveBeenCalled();
});
