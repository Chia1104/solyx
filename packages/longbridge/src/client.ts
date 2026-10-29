import { noop } from "es-toolkit";
import ky from "ky";
import * as z from "zod";

import { createBudget } from "./budget.ts";
import type { Lane } from "./budget.ts";
import { longbridgeDataCenter } from "./sign-in.ts";
import {
  Command,
  PacketType,
  ResponseStatus,
  authRequest,
  decodeClose,
  decodeCommandRates,
  decodeError,
  decodePacket,
  encodeRequest,
  heartbeatRequest,
} from "./wire.ts";
import type { CommandRate, Packet } from "./wire.ts";

const API_URL = "https://openapi.longbridge.com";

const QUOTE_URL =
  "wss://openapi-quote.longbridge.com/v2?version=1&codec=1&platform=9";

// Longbridge documents ten quote requests a second and five at once for an account, its HTTP API
// and its quote server alike, and tells each connection what it takes of each command.
const REQUESTS_PER_SECOND = 10;

const CONCURRENT_REQUESTS = 5;

// Its HTTP API takes far less, counted across every endpoint: requests a quarter of a second apart
// go through, while ones closer, or a few at once, are refused with a pause to wait.
const HTTP_GAP_MS = 250;

// The server counts requests as they arrive, which the network may bunch, so each second is
// counted a little longer here.
const RATE_WINDOW_MS = 1100;

/** The code Longbridge's quote server refuses a request with when it came too fast. */
const RATE_LIMITED = 301_606;

// A request refused as too fast is asked again after a pause that grows, a few times, as
// Longbridge's own SDK holds a request back rather than failing it.
const RATE_LIMITED_RETRIES = 4;

const RATE_LIMITED_PAUSE_MS = 1000;

// The longest pause a refusal may ask for that is waited out rather than failing the request.
const MAX_RETRY_AFTER_MS = 10_000;

// What the server waits before it answers a request with a timeout; silence past it and a grace
// means the connection is gone.
const REQUEST_TIMEOUT_MS = 10_000;

const ANSWER_GRACE_MS = 5_000;

// The runtime's WebSocket hides the server's pings, so a heartbeat this often finds a connection
// that died quietly, as one does across a sleep, within a request's timeout of it.
const HEARTBEAT_MS = 30_000;

const MAX_REQUEST_ID = 0xffffffff;

// Its descriptions in traditional Chinese, as the app names US listings, unless a read asks for another.
const LANGUAGE = "zh-HK";

/** A failure Longbridge reported, with its own code where it gave one. */
export class LongbridgeError extends Error {
  readonly code: number | null;
  /** Whether Longbridge refused the request as coming too fast. */
  readonly rateLimited: boolean;
  /** How long Longbridge asked to wait before asking again; `null` where it named no pause. */
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    code: number | null = null,
    {
      rateLimited = false,
      retryAfterMs = null,
    }: { rateLimited?: boolean; retryAfterMs?: number | null } = {}
  ) {
    super(message);
    this.name = "LongbridgeError";
    this.code = code;
    this.rateLimited = rateLimited;
    this.retryAfterMs = retryAfterMs;
  }
}

const envelopeSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown(),
});

type Envelope = z.infer<typeof envelopeSchema>;

const otpSchema = z.object({ otp: z.string() });

/**
 * The pause a 429 asks for, by its `Retry-After` header or else its message, which names it as
 * "please retry after: 0.8s" or "請 0.2 秒後重試"; `null` where it names none or more than is
 * waited out.
 */
function retryAfter(response: Response, message: string): number | null {
  const named =
    response.headers.get("retry-after") ??
    /retry after:?\s*([\d.]+)\s*s/i.exec(message)?.[1] ??
    /([\d.]+)\s*秒後重試/.exec(message)?.[1];

  const ms = Number(named ?? Number.NaN) * 1000;

  return Number.isFinite(ms) && ms >= 0 && ms <= MAX_RETRY_AFTER_MS ? ms : null;
}

export interface LongbridgeOptions {
  /** The signed-in user's OAuth access token, which the caller refreshes before it expires; rejects while signed out. */
  accessToken: () => Promise<string>;
  /** @default globalThis.fetch */
  fetch?: typeof fetch;
  connect?: LongbridgeConnect;
  /** Hears each refusal as too fast, before the request is tried again. */
  onRateLimited?: (error: LongbridgeError) => void;
}

/** One sign-in's Longbridge, its HTTP API and its quote server, under one budget. */
export interface Longbridge {
  /** `path`'s data over HTTP as `schema` reads it, its text in `language`; fails naming `what` and the reason Longbridge gives. */
  read<Schema extends z.ZodType>(
    path: string,
    searchParams: Record<string, string>,
    schema: Schema,
    what: string,
    language?: string
  ): Promise<z.infer<Schema>>;
  /** Sends a request to the quote server once the connection is open and signed in; resolves with the answer's body. */
  request(command: Command, body: Uint8Array): Promise<Uint8Array>;
  /** Hears every push on every connection; returns a function that stops. */
  onPush(listener: LongbridgePushListener): () => void;
  /** Hears a signed-in connection drop, which takes its subscriptions with it; returns a function that stops. */
  onDrop(listener: () => void): () => void;
  /** Closes the connection, which the next request opens again, as a sign-in to another account needs. */
  disconnect(): void;
  /** Closes the connection for good. */
  close(): void;
}

/** The WebSocket surface the client uses, so tests can drive it without a server. */
export interface LongbridgeWebSocket {
  send(data: Uint8Array): void;
  close(): void;
  addEventListener(
    type: "open" | "close" | "error" | "message",
    listener: (event: { data?: unknown }) => void
  ): void;
}

/** Opens a socket to `url` with the upgrade's headers; tests stand in for the server here. */
export type LongbridgeConnect = (
  url: string,
  headers: Record<string, string>
) => LongbridgeWebSocket;

function openWebSocket(url: string, headers: Record<string, string>) {
  const socket = new WebSocket(url, { headers });

  socket.binaryType = "arraybuffer";

  return socket;
}

/** A push the server sent: its command and its body. */
export type LongbridgePushListener = (
  command: number,
  body: Uint8Array
) => void;

interface Connection {
  call(command: Command, body: Uint8Array): Promise<Uint8Array>;
  close(): void;
}

/**
 * Longbridge's OpenAPI on one sign-in: its HTTP API, and its quote server over one connection,
 * which a request opens when none is open, fetching a one-time password with the access token and
 * signing in with it; a connection that closes, refuses or stops answering is dropped with its
 * requests, and the next request opens another. Every request of both draws on one budget, the
 * pace Longbridge allows an account's quotes, so every reader of a sign-in shares one instance.
 */
export function createLongbridge({
  accessToken,
  fetch,
  connect = openWebSocket,
  onRateLimited,
}: LongbridgeOptions): Longbridge {
  // Its own retries would go around the budget, so a refusal is tried again through it instead.
  const http = ky.create({
    baseUrl: API_URL,
    fetch,
    retry: 0,
    throwHttpErrors: false,
  });

  const budget = createBudget({
    limit: REQUESTS_PER_SECOND,
    concurrency: CONCURRENT_REQUESTS,
    windowMs: RATE_WINDOW_MS,
  });

  const httpLane = budget.lane(REQUESTS_PER_SECOND, { gapMs: HTTP_GAP_MS });

  // Each command's pace, as the server last told a connection of this sign-in.
  const lanes = new Map<number, Lane>();

  // A burst below the rate caps it, since more than the burst may not come at once.
  function setRates(rates: readonly CommandRate[]) {
    for (const { command, limit, burst } of rates) {
      const pace = Math.min(limit, burst || limit);

      if (pace > 0 && lanes.get(command)?.limit !== pace) {
        lanes.set(command, budget.lane(pace));
      }
    }
  }

  /** A command's lane, at Longbridge's documented pace until the server tells its own. */
  function laneOf(command: Command): Lane {
    const kept = lanes.get(command);

    if (kept) return kept;

    const lane = budget.lane(REQUESTS_PER_SECOND);

    lanes.set(command, lane);

    return lane;
  }

  /**
   * `attempt` within `lane`, asked again while it is refused as too fast, a few times: the lane
   * holds every request of its kind back for the pause Longbridge names, or else a growing one,
   * since the next would be refused too.
   */
  async function paced<T>(lane: Lane, attempt: () => Promise<T>): Promise<T> {
    for (let tries = 0; ; tries += 1) {
      try {
        return await budget.run(lane, attempt);
      } catch (error) {
        if (
          !(error instanceof LongbridgeError) ||
          !error.rateLimited ||
          tries >= RATE_LIMITED_RETRIES
        ) {
          throw error;
        }

        onRateLimited?.(error);
        budget.pause(
          lane,
          error.retryAfterMs ?? RATE_LIMITED_PAUSE_MS * (tries + 1)
        );
      }
    }
  }

  let current: Promise<Connection> | undefined;
  let closed = false;
  const pushListeners = new Set<LongbridgePushListener>();
  const dropListeners = new Set<() => void>();

  /** `path`'s envelope, refused as too fast on a 429. */
  async function get(
    path: string,
    token: string,
    what: string,
    options: { searchParams?: Record<string, string>; language?: string } = {}
  ): Promise<{ status: number; envelope: Envelope | undefined }> {
    const response = await http.get(path, {
      searchParams: options.searchParams,
      headers: {
        authorization: `Bearer ${token}`,
        "x-dc-region": longbridgeDataCenter(token),
        ...(options.language && { "accept-language": options.language }),
      },
    });

    const envelope = envelopeSchema.safeParse(
      await response.json().catch(() => null)
    ).data;

    if (response.status === 429) {
      const reason = envelope?.message ?? "HTTP 429";

      throw new LongbridgeError(
        `Longbridge refused ${what}: ${reason}`,
        envelope?.code ?? null,
        { rateLimited: true, retryAfterMs: retryAfter(response, reason) }
      );
    }

    return { status: response.status, envelope };
  }

  async function oneTimePassword(token: string): Promise<string> {
    const { status, envelope } = await get(
      "v1/socket/token",
      token,
      "the sign-in"
    );

    if (!envelope) {
      throw new LongbridgeError(
        `Longbridge answered the sign-in with HTTP ${status}`
      );
    }

    const otp = otpSchema.safeParse(envelope.data).data;

    if (envelope.code !== 0 || !otp) {
      throw new LongbridgeError(
        `Longbridge refused the sign-in: ${envelope.message}`,
        envelope.code
      );
    }

    return otp.otp;
  }

  /** `onDrop` hears whether the connection had signed in when it dropped. */
  async function open(
    onDrop: (signedIn: boolean) => void
  ): Promise<Connection> {
    const token = await accessToken();
    const otp = await oneTimePassword(token);

    const socket = connect(QUOTE_URL, {
      "x-dc-region": longbridgeDataCenter(token),
    });

    const pending = new Map<
      number,
      {
        resolve: (body: Uint8Array) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >();

    let nextId = 1;
    let dropped: Error | undefined;
    let refuseOpening: ((reason: Error) => void) | undefined;
    let signedIn = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    function drop(reason: Error) {
      if (dropped) return;

      dropped = reason;
      clearInterval(heartbeat);

      for (const { reject, timer } of pending.values()) {
        clearTimeout(timer);
        reject(reason);
      }

      pending.clear();
      refuseOpening?.(reason);
      socket.close();
      onDrop(signedIn);
    }

    function settle(
      packet: Extract<Packet, { type: typeof PacketType.Response }>,
      what: string
    ) {
      const waiting = pending.get(packet.id);

      if (!waiting) return;

      pending.delete(packet.id);
      clearTimeout(waiting.timer);

      if (packet.status === ResponseStatus.Success) {
        waiting.resolve(packet.body);

        return;
      }

      const { code, message } = decodeError(packet.body);

      waiting.reject(
        new LongbridgeError(
          `Longbridge refused ${what}: ${message || `status ${packet.status}`}`,
          code || null,
          { rateLimited: code === RATE_LIMITED }
        )
      );
    }

    const purposes = new Map<number, string>();

    function call(
      command: Command,
      body: Uint8Array,
      what = "the request"
    ): Promise<Uint8Array> {
      if (dropped) return Promise.reject(dropped);

      const id = nextId;

      nextId = nextId === MAX_REQUEST_ID ? 1 : nextId + 1;
      purposes.set(id, what);

      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            drop(
              new LongbridgeError("Longbridge's quote server stopped answering")
            ),
          REQUEST_TIMEOUT_MS + ANSWER_GRACE_MS
        );

        pending.set(id, { resolve, reject, timer });
        socket.send(
          encodeRequest({ command, id, timeoutMs: REQUEST_TIMEOUT_MS, body })
        );
      });
    }

    socket.addEventListener("message", ({ data }) => {
      if (!(data instanceof ArrayBuffer)) return;

      const packet = decodePacket(new Uint8Array(data));

      if (packet?.type === PacketType.Response) {
        settle(packet, purposes.get(packet.id) ?? "the request");
        purposes.delete(packet.id);
      } else if (packet?.command === Command.Close) {
        const { reason } = decodeClose(packet.body);

        drop(
          new LongbridgeError(
            `Longbridge closed the quote connection: ${reason}`
          )
        );
      } else if (packet && !dropped) {
        for (const listener of pushListeners) {
          listener(packet.command, packet.body);
        }
      }
    });

    socket.addEventListener("close", () =>
      drop(new LongbridgeError("Longbridge closed the quote connection"))
    );

    const unreachable = () =>
      drop(
        new LongbridgeError("Longbridge's quote server could not be reached")
      );

    socket.addEventListener("error", unreachable);

    const timer = setTimeout(unreachable, REQUEST_TIMEOUT_MS);

    try {
      await new Promise<void>((resolve, reject) => {
        refuseOpening = reject;
        socket.addEventListener("open", () => resolve());
      });
    } finally {
      clearTimeout(timer);
      refuseOpening = undefined;
    }

    try {
      await call(
        Command.Auth,
        authRequest(otp, { "accept-language": "en" }),
        "the sign-in"
      );

      setRates(
        decodeCommandRates(
          await call(
            Command.QueryUserQuoteProfile,
            new Uint8Array(),
            "the quote profile"
          )
        )
      );
    } catch (error) {
      if (error instanceof Error) drop(error);

      throw error;
    }

    // The server may close the connection on the answer's heels.
    if (dropped) throw dropped;

    signedIn = true;

    // An unanswered heartbeat drops the connection as any unanswered request does.
    heartbeat = setInterval(() => {
      call(
        Command.Heartbeat,
        heartbeatRequest(Date.now()),
        "the heartbeat"
      ).catch(noop);
    }, HEARTBEAT_MS);

    return {
      call,
      close: () =>
        drop(new LongbridgeError("The Longbridge connection closed")),
    };
  }

  function connection(): Promise<Connection> {
    if (closed) {
      return Promise.reject(
        new LongbridgeError("The Longbridge connection closed")
      );
    }

    if (!current) {
      const opening: Promise<Connection> = open((signedIn) => {
        if (current === opening) current = undefined;

        if (signedIn) for (const listener of dropListeners) listener();
      });

      current = opening;
      opening.catch(() => {
        if (current === opening) current = undefined;
      });
    }

    return current;
  }

  function listen<Listener>(listeners: Set<Listener>, listener: Listener) {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }

  function disconnect() {
    void current?.then((opened) => opened.close()).catch(() => undefined);
    current = undefined;
  }

  return {
    async read(path, searchParams, schema, what, language = LANGUAGE) {
      const token = await accessToken();

      const { status, envelope } = await paced(httpLane, () =>
        get(path, token, what, { searchParams, language })
      );

      if (!envelope) {
        throw new LongbridgeError(
          `Longbridge answered ${what} with HTTP ${status}`
        );
      }

      if (envelope.code !== 0) {
        throw new LongbridgeError(
          `Longbridge refused ${what}: ${envelope.message}`,
          envelope.code
        );
      }

      const read = schema.safeParse(envelope.data);

      if (!read.success) {
        throw new LongbridgeError(`Longbridge's ${what} did not read`);
      }

      return read.data;
    },

    // The connection opens first, since it tells each command's pace.
    async request(command, body) {
      await connection();

      return paced(laneOf(command), async () =>
        (await connection()).call(command, body)
      );
    },

    onPush: (listener) => listen(pushListeners, listener),

    onDrop: (listener) => listen(dropListeners, listener),

    disconnect,

    close() {
      closed = true;
      disconnect();
    },
  };
}
