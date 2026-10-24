import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import type { SupportedMessagePort } from "@orpc/client/message-port";
import type { RouterContractClient } from "@orpc/contract";

import type { BacktestKernel } from "@solyx/core/backtest";

import { processCalls } from "../../rpc/process-calls.ts";
import type { UtilityChild } from "../../rpc/process-calls.ts";

import type { kernelContract } from "./kernel.contract.ts";

// Far past what a backtest over a listing's history takes; past it the process is ended, so a run
// that stalls fails the script waiting on it rather than every call after it.
const ANSWER_TIMEOUT_MS = 30_000;

/** The kernel in a utility process of its own, until the process ends. */
export interface KernelProcess extends BacktestKernel {
  /** Why the process ended, once it has. */
  ended(): Error | undefined;
}

/**
 * Calls the kernel in `child` over `port`. A call it does not answer in time ends the process, and
 * an ended process fails every call still waiting and every later one.
 */
export function connectKernel(
  child: UtilityChild,
  port: SupportedMessagePort,
  answerTimeoutMs = ANSWER_TIMEOUT_MS
): KernelProcess {
  // Columns cross as the structured clone copies them, typed arrays whole, rather than as JSON.
  const kernel: RouterContractClient<typeof kernelContract> = createORPCClient(
    new RPCLink({ port, experimental_transfer: () => [] })
  );

  const { call, ended } = processCalls(child, "The kernel", answerTimeoutMs);

  return {
    ended,
    backtest: (request) =>
      call((signal) => kernel.backtest(request, { signal })),
    scan: (request) => call((signal) => kernel.scan(request, { signal })),
    walkForward: (request) =>
      call((signal) => kernel.walkForward(request, { signal })),
    rolling: (request) => call((signal) => kernel.rolling(request, { signal })),
  };
}

/** The kernel, its process started on first use and again once one has ended. */
export function createKernel(
  open: () => Promise<KernelProcess>
): BacktestKernel {
  let starting: Promise<KernelProcess> | undefined;

  // Calls that come together share one process.
  async function current(): Promise<KernelProcess> {
    starting ??= open();

    const started = starting;
    const kernel = await started.catch(() => undefined);

    if (kernel && !kernel.ended()) return kernel;

    if (starting === started) starting = undefined;

    // One that failed to start fails this call with why, and is started again on the next.
    return kernel ? current() : started;
  }

  return {
    backtest: async (request) => (await current()).backtest(request),
    scan: async (request) => (await current()).scan(request),
    walkForward: async (request) => (await current()).walkForward(request),
    rolling: async (request) => (await current()).rolling(request),
  };
}
