import { createServer } from "node:http";
import type { Server, ServerResponse } from "node:http";

import { noop } from "es-toolkit";
import * as z from "zod";

const CALLBACK_HOST = "127.0.0.1";

export const SignInOutcome = {
  SignedIn: "signed-in",
  Failed: "failed",
} as const;

export type SignInOutcome = (typeof SignInOutcome)[keyof typeof SignInOutcome];

/** The page the browser lands on when a sign-in returns, written for whoever started it. */
export type SignInPage = (outcome: SignInOutcome, detail?: string) => string;

export interface SignInCallbackOptions<T> {
  /** Whose sign-in this is, as its errors name it. */
  name: string;
  path: string;
  /** Tried first; a port another listener holds falls back to any free one. */
  preferredPort?: number;
  page: SignInPage;
  /** Ends the wait. */
  signal: AbortSignal;
  /**
   * Whether a request is the provider's own return, as its state or a path only the provider knows
   * proves. Any other, a refusal included, is stray and the sign-in keeps waiting.
   */
  verify(query: URLSearchParams): boolean;
  /** What the provider's return carries; `undefined` when it lacks it. */
  accept(query: URLSearchParams): T | undefined;
}

export interface SignInCallback<T> {
  /** Where the provider sends the browser back to. */
  redirectUri: string;
  /** What the return carried; rejects when the provider refuses or the sign-in is cancelled. */
  returned: Promise<T>;
  close(): void;
}

const addressSchema = z.object({ port: z.number() });

function listen(server: Server, port: number) {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, CALLBACK_HOST, () => {
      server.off("error", reject);

      // Port 0 asks the OS for one, so the listener reports which it got.
      resolve(addressSchema.parse(server.address()).port);
    });
  });
}

/**
 * Listens on this computer for the browser a sign-in sends back. The listener is open only until
 * `close`, which every sign-in calls once it has its answer or gives up.
 */
export async function listenForSignIn<T>(
  options: SignInCallbackOptions<T>
): Promise<SignInCallback<T>> {
  if (options.signal.aborted) throw new Error("Sign-in cancelled");

  let settle: (value: T) => void = noop;
  let fail: (error: Error) => void = noop;

  const returned = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  // A sign-in closed before it waits must not leave a rejection nobody handles.
  returned.catch(noop);

  const page = (
    response: ServerResponse,
    status: number,
    outcome: SignInOutcome,
    detail?: string
  ) => {
    // The listener ends with its sign-in, so a browser keeps no connection open to a port the
    // next sign-in, or another app, listens on.
    response.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      connection: "close",
    });
    response.end(options.page(outcome, detail));
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${CALLBACK_HOST}`);

    if (url.pathname !== options.path) {
      response.writeHead(404).end();

      return;
    }

    // A stray request fails on its own, so no other process or page can end the sign-in.
    if (!options.verify(url.searchParams)) {
      page(response, 400, SignInOutcome.Failed);

      return;
    }

    const error = url.searchParams.get("error");

    if (error) {
      page(response, 400, SignInOutcome.Failed, error);
      fail(new Error(`${options.name} sign-in failed: ${error}`));

      return;
    }

    const accepted = options.accept(url.searchParams);

    if (accepted === undefined) {
      page(response, 400, SignInOutcome.Failed);

      return;
    }

    page(response, 200, SignInOutcome.SignedIn);
    settle(accepted);
  });

  const abort = () => fail(new Error("Sign-in cancelled"));

  const close = () => {
    options.signal.removeEventListener("abort", abort);
    server.close();
    // A browser's spare connection would otherwise keep the listener, and the port, alive.
    server.closeAllConnections();
  };

  options.signal.addEventListener("abort", abort, { once: true });

  try {
    const { preferredPort } = options;

    const port = await (preferredPort === undefined
      ? listen(server, 0)
      : listen(server, preferredPort).catch(() => listen(server, 0)));

    return {
      redirectUri: `http://${CALLBACK_HOST}:${port}${options.path}`,
      returned,
      close,
    };
  } catch (error) {
    close();

    throw error;
  }
}
