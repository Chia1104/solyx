import { join } from "node:path";

import { utilityProcess } from "electron";

import type {
  FubonAccount,
  FubonRealtime,
  FubonSessionOptions,
} from "@solyx/brokers/fubon";

import { FubonMethod } from "../../../utility/fubon-protocol.ts";
import type {
  FubonAnswers,
  FubonCall,
  FubonReply,
  FubonRequest,
} from "../../../utility/fubon-protocol.ts";

// Main is bundled into dist/main, next to dist/utility.
const FUBON_ENTRY = join(import.meta.dirname, "../utility/fubon.mjs");

// Long enough for Fubon to answer a sign-in; past it the process is ended, so a stalled SDK
// fails the chart waiting on it instead of holding it.
const ANSWER_TIMEOUT_MS = 30_000;

/** A Fubon session held by a utility process of its own. */
export interface FubonProcess {
  accounts: FubonAccount[];
  /** Exchanges the session for a market data token. */
  realtime(): Promise<FubonRealtime>;
  /** Signs out and ends the process. */
  close(): void;
}

interface PendingCall {
  resolve(answer: FubonAnswers[FubonMethod]): void;
  reject(reason: Error): void;
  timer: NodeJS.Timeout;
}

/**
 * Signs in to Fubon from a utility process, since the SDK's calls block until Fubon answers,
 * its native code could crash, and it moves its process to the folder it logs to.
 */
export async function openFubonProcess(
  options: FubonSessionOptions
): Promise<FubonProcess> {
  const child = utilityProcess.fork(FUBON_ENTRY, [], {
    serviceName: "Fubon SDK",
  });

  const pending = new Map<number, PendingCall>();

  let nextId = 0;

  let stopped: Error | undefined;

  function stop(reason: Error) {
    stopped ??= reason;

    for (const call of pending.values()) {
      clearTimeout(call.timer);
      call.reject(stopped);
    }

    pending.clear();
    child.kill();
  }

  child.on("message", (reply: FubonReply) => {
    const call = pending.get(reply.id);

    if (!call) return;

    pending.delete(reply.id);
    clearTimeout(call.timer);

    if ("error" in reply) call.reject(new Error(reply.error));
    else call.resolve(reply.answer);
  });

  child.on("exit", (code) =>
    stop(new Error(`The Fubon SDK exited with code ${code}`))
  );

  function call<Method extends FubonMethod>(
    request: Extract<FubonCall, { method: Method }>
  ): Promise<FubonAnswers[Method]> {
    if (stopped) return Promise.reject(stopped);

    const id = nextId++;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          stop(
            new Error(
              `Fubon did not answer within ${ANSWER_TIMEOUT_MS / 1000} seconds`
            )
          ),
        ANSWER_TIMEOUT_MS
      );

      // SAFETY: the Fubon process answers each call with its own method's answer.
      pending.set(id, {
        resolve: resolve as PendingCall["resolve"],
        reject,
        timer,
      });
      child.postMessage({ ...request, id } satisfies FubonRequest);
    });
  }

  try {
    const accounts = await call({ method: FubonMethod.Open, options });

    return {
      accounts,

      realtime: () => call({ method: FubonMethod.Realtime }),

      close() {
        // The process ends even when signing out fails or stalls.
        void call({ method: FubonMethod.Close })
          .catch(() => undefined)
          .finally(() => child.kill());
      },
    };
  } catch (error) {
    child.kill();
    throw error;
  }
}
