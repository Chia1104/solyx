import { MessageChannel } from "node:worker_threads";

import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import type { BacktestColumns, BacktestRun } from "@solyx/kernel/native";

import {
  connectKernel,
  createKernel,
} from "../src/modules/kernel/kernel-client.ts";
import type { KernelProcess } from "../src/modules/kernel/kernel-client.ts";
import { kernelContract } from "../src/modules/kernel/kernel.contract.ts";
import { keepMessages } from "../src/rpc/messages.ts";

const BARS = 3;

const COLUMNS: BacktestColumns = {
  close: Float64Array.of(100, 101, 102),
  adjustedClose: Float64Array.of(100, 101, 102),
  factor: new Float64Array(BARS).fill(1),
  carry: new Float64Array(BARS).fill(1),
  buyPrice: Float64Array.of(100, 101, 102),
  sellPrice: Float64Array.of(100, 101, 102),
  buyLocked: new Uint8Array(BARS),
  sellLocked: new Uint8Array(BARS),
  day: Int32Array.of(20_000, 20_001, 20_002),
  lines: [Float64Array.of(Number.NaN, 1, 2)],
  entry: { above: [0, 0] },
  exit: { below: [0, 0] },
  capital: 1_000_000,
  commissionRate: 0,
  minCommission: 0,
  sellTaxRate: 0,
};

const METRICS = {
  totalReturn: 0,
  annualReturn: null,
  maxDrawdown: 0,
  trades: 0,
  winRate: null,
  payoffRatio: null,
  exposure: 0,
  buyAndHold: 0.02,
  buyAndHoldDrawdown: 0,
};

const never = () => new Promise<never>(() => undefined);

/** A process serving the kernel over a channel as `utility/kernel.ts` does, its run `run`. */
function fakeChild(
  run: (columns: BacktestColumns) => Promise<BacktestRun> = async () => ({
    equity: new Float64Array(BARS).fill(1_000_000),
    trades: {
      entry: new Int32Array(0),
      exit: new Int32Array(0),
      entryPrice: new Float64Array(0),
      exitPrice: new Float64Array(0),
      shares: new Float64Array(0),
      profit: new Float64Array(0),
      return: new Float64Array(0),
    },
    all: METRICS,
    inSample: null,
    outOfSample: null,
  })
) {
  const { port1, port2 } = new MessageChannel();
  const served = implement(kernelContract);
  const received: BacktestColumns[] = [];
  const exits: ((code: number) => void)[] = [];
  const kill = vi.fn();

  const handler = new RPCHandler(
    served.router({
      backtest: served.backtest.handler(({ input }) => {
        received.push(input);

        return run(input);
      }),
    }),
    { clientInterceptors: [keepMessages], experimental_transfer: () => [] }
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
    connectKernel(child, port1, answerTimeoutMs);

  return { connect, received, exit, kill };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

test("columns cross to the kernel as typed arrays, and its run comes back as them", async () => {
  const { connect, received, kill } = fakeChild();
  const run = await connect().backtest(COLUMNS);

  const [columns] = received;

  expect(columns.close).toBeInstanceOf(Float64Array);
  expect(columns.buyLocked).toBeInstanceOf(Uint8Array);
  expect(columns.day).toEqual(COLUMNS.day);
  expect(Number.isNaN(columns.lines[0][0])).toBe(true);
  expect(run.equity).toBeInstanceOf(Float64Array);
  expect(run.trades.entry).toBeInstanceOf(Int32Array);
  expect(run.all.annualReturn).toBeNull();
  expect(kill).not.toHaveBeenCalled();
});

test("a run the kernel does not answer in time ends the process, failing it and every later run", async () => {
  const { connect, kill } = fakeChild(never);
  const kernel = connect(1000);
  const stalled = kernel.backtest(COLUMNS);

  vi.advanceTimersByTime(1000);

  await expect(stalled).rejects.toThrow("did not answer within 1 seconds");
  expect(kill).toHaveBeenCalled();
  expect(kernel.ended()).toBeInstanceOf(Error);
  await expect(kernel.backtest(COLUMNS)).rejects.toThrow("did not answer");
});

test("runs that come together share one process, and one that ended is started again", async () => {
  const children: ReturnType<typeof fakeChild>[] = [];

  const kernel = createKernel(async () => {
    const child = fakeChild();

    children.push(child);

    return child.connect();
  });

  await Promise.all([kernel.backtest(COLUMNS), kernel.backtest(COLUMNS)]);

  expect(children).toHaveLength(1);
  expect(children[0].received).toHaveLength(2);

  children[0].exit(1);
  await kernel.backtest(COLUMNS);

  expect(children).toHaveLength(2);
  expect(children[1].received).toHaveLength(1);
});

test("a process that fails to start fails that run, and the next run starts one", async () => {
  const open = vi
    .fn<() => Promise<KernelProcess>>()
    .mockRejectedValueOnce(new Error("The kernel exited with code 1"))
    .mockImplementation(async () => fakeChild().connect());

  const kernel = createKernel(open);

  await expect(kernel.backtest(COLUMNS)).rejects.toThrow("exited with code 1");
  await expect(kernel.backtest(COLUMNS)).resolves.toMatchObject({
    all: METRICS,
  });
  expect(open).toHaveBeenCalledTimes(2);
});
