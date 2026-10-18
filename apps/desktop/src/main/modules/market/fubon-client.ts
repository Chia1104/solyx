import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import type { SupportedMessagePort } from "@orpc/client/message-port";
import type { RouterContractClient } from "@orpc/contract";

import type {
  FubonAccount,
  FubonReader,
  FubonRealtime,
  FubonSessionOptions,
} from "@solyx/brokers/fubon";

import type { fubonContract } from "../../../utility/fubon.contract.ts";

// Long enough for Fubon to answer a sign-in; past it the process is ended, so a stalled SDK
// fails the chart waiting on it instead of holding it.
const ANSWER_TIMEOUT_MS = 30_000;

/** A Fubon session held by a utility process of its own, which a Fubon broker reads through. */
export interface FubonProcess extends FubonReader {
  accounts: FubonAccount[];
  /** Exchanges the session for a market data token. */
  realtime(): Promise<FubonRealtime>;
  /** Signs out and ends the process. */
  close(): void;
}

/** The part of Electron's `UtilityProcess` the session needs besides its port, so tests stand in for it. */
export interface FubonChild {
  on(event: "exit", listener: (code: number) => void): void;
  kill(): void;
}

/**
 * Signs in to Fubon through `child`, calling it over `port`, and holds the session it keeps. A
 * call Fubon does not answer in time ends the process, and an ended process fails every call
 * still waiting and every later one, so nothing signs in again behind the user's back.
 */
export async function connectFubon(
  child: FubonChild,
  port: SupportedMessagePort,
  options: FubonSessionOptions,
  answerTimeoutMs = ANSWER_TIMEOUT_MS
): Promise<FubonProcess> {
  const fubon: RouterContractClient<typeof fubonContract> = createORPCClient(
    new RPCLink({ port })
  );

  // Aborts every call still waiting once the process is ended.
  const ending = new AbortController();

  let stopped: Error | undefined;

  function stop(reason: Error) {
    stopped ??= reason;
    ending.abort(stopped);
    child.kill();
  }

  child.on("exit", (code) =>
    stop(new Error(`The Fubon SDK exited with code ${code}`))
  );

  async function call<T>(send: (signal: AbortSignal) => Promise<T>) {
    if (stopped) throw stopped;

    const timer = setTimeout(
      () =>
        stop(
          new Error(
            `Fubon did not answer within ${answerTimeoutMs / 1000} seconds`
          )
        ),
      answerTimeoutMs
    );

    try {
      return await send(ending.signal);
    } catch (error) {
      // A call the process ended under fails with why it ended.
      throw stopped ?? error;
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    const accounts = await call((signal) => fubon.open(options, { signal }));

    return {
      accounts,

      realtime: () => call((signal) => fubon.realtime(undefined, { signal })),
      holdings: () => call((signal) => fubon.holdings(undefined, { signal })),
      orders: (from) => call((signal) => fubon.orders(from, { signal })),
      fills: (from) => call((signal) => fubon.fills(from, { signal })),

      close() {
        // The process ends even when signing out fails or stalls.
        void call((signal) => fubon.close(undefined, { signal }))
          .catch(() => undefined)
          .finally(() => child.kill());
      },
    };
  } catch (error) {
    child.kill();
    throw error;
  }
}
