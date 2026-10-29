import { gzipSync } from "node:zlib";

import { BinaryReader, BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { noop } from "es-toolkit";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import * as z from "zod";

import { LongbridgeError, createLongbridge } from "../src/client.ts";
import type { LongbridgeWebSocket } from "../src/client.ts";
import { Command, securitiesRequest } from "../src/wire.ts";

const TOKEN = "hk_eyJ.test.token";

interface SentRequest {
  command: number;
  id: number;
  body: Uint8Array;
}

interface Answer {
  status: number;
  body: Uint8Array;
}

/** What a test's server answers a request with; `undefined` leaves it unanswered. */
type Handler = (request: SentRequest) => Answer | undefined;

const ok = (body: Uint8Array): Answer => ({ status: 0, body });

function refused(status: number, code: number, message: string): Answer {
  return {
    status,
    body: new BinaryWriter()
      .tag(1, WireType.Varint)
      .uint64(code)
      .tag(2, WireType.LengthDelimited)
      .string(message)
      .finish(),
  };
}

function response(
  { command, id }: SentRequest,
  { status, body }: Answer,
  gzip = false
) {
  const payload = gzip ? new Uint8Array(gzipSync(body)) : body;
  const packet = new Uint8Array(10 + payload.length);
  const view = new DataView(packet.buffer);

  packet[0] = gzip ? 0x22 : 0x02;
  packet[1] = command;
  view.setUint32(2, id);
  packet[6] = status;
  packet[7] = (payload.length >> 16) & 0xff;
  packet[8] = (payload.length >> 8) & 0xff;
  packet[9] = payload.length & 0xff;
  packet.set(payload, 10);

  return packet.buffer;
}

function readRequest(packet: Uint8Array): SentRequest {
  const view = new DataView(packet.buffer, packet.byteOffset);
  const length = (packet[8] << 16) | (packet[9] << 8) | packet[10];

  return {
    command: packet[1],
    id: view.getUint32(2),
    body: packet.slice(11, 11 + length),
  };
}

/** A request body's text and number fields, by field number. */
function requestFields(body: Uint8Array) {
  const reader = new BinaryReader(body);
  const fields = new Map<number, (string | number)[]>();

  while (reader.pos < reader.len) {
    const [field, wireType] = reader.tag();

    const value =
      wireType === WireType.Varint ? reader.int32() : reader.string();

    fields.set(field, [...(fields.get(field) ?? []), value]);
  }

  return fields;
}

// The sign-in and the quote profile, which every connection asks before anything else.
const HANDSHAKE = new Set([2, 4]);

/** What a connection asked once it was open, past the sign-in and the profile. */
const askedOf = (socket: FakeSocket) =>
  socket.requests.filter(({ command }) => !HANDSHAKE.has(command));

/** `UserQuoteProfileResponse` with how fast the server takes each command. */
function quoteProfile(
  rates: { command: number; limit: number; burst: number }[]
) {
  const writer = new BinaryWriter();

  for (const { command, limit, burst } of rates) {
    writer
      .tag(5, WireType.LengthDelimited)
      .fork()
      .tag(1, WireType.Varint)
      .int32(command)
      .tag(2, WireType.Varint)
      .int32(limit)
      .tag(3, WireType.Varint)
      .int32(burst)
      .join();
  }

  return writer.finish();
}

/** Plays Longbridge's quote server over fake sockets. */
class FakeSocket implements LongbridgeWebSocket {
  readonly requests: SentRequest[] = [];
  closed = false;
  private readonly handlers = new Map<
    string,
    ((event: { data?: unknown }) => void)[]
  >();

  readonly headers: Record<string, string>;
  private readonly answer: Handler;
  private readonly profile: Uint8Array;

  constructor(
    headers: Record<string, string>,
    answer: Handler,
    profile: Uint8Array
  ) {
    this.headers = headers;
    this.answer = answer;
    this.profile = profile;
    queueMicrotask(() => this.emit("open"));
  }

  addEventListener(
    type: "open" | "close" | "error" | "message",
    listener: (event: { data?: unknown }) => void
  ) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), listener]);
  }

  send(data: Uint8Array) {
    const request = readRequest(data);

    this.requests.push(request);

    const answer = HANDSHAKE.has(request.command)
      ? ok(request.command === 4 ? this.profile : new Uint8Array())
      : this.answer(request);

    if (answer) {
      queueMicrotask(() =>
        this.emit("message", response(request, answer, request.command === 10))
      );
    }
  }

  close() {
    if (this.closed) return;

    this.closed = true;
    this.emit("close");
  }

  emit(type: "open" | "close" | "error" | "message", data?: ArrayBuffer) {
    for (const handler of this.handlers.get(type) ?? []) handler({ data });
  }
}

interface Http {
  path: string;
  searchParams: URLSearchParams;
  headers: Headers;
}

/** What a test's HTTP API answers each read with; the one-time password unless told otherwise. */
type HttpHandler = (request: Http) => Response | Promise<Response>;

function setup(
  answer: Handler,
  {
    envelope = { code: 0, message: "success", data: { otp: "otp-1" } },
    rates = [],
    http = () => Response.json({ code: 0, message: "success", data: {} }),
  }: {
    envelope?: unknown;
    rates?: { command: number; limit: number; burst: number }[];
    http?: HttpHandler;
  } = {}
) {
  const sockets: FakeSocket[] = [];
  const passwords: Http[] = [];
  const reads: Http[] = [];
  const rateLimited: LongbridgeError[] = [];

  const longbridge = createLongbridge({
    accessToken: async () => TOKEN,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);

      const asked = {
        path: url.pathname,
        searchParams: url.searchParams,
        headers: request.headers,
      };

      if (url.pathname === "/v1/socket/token") {
        passwords.push(asked);

        return Response.json(envelope);
      }

      reads.push(asked);

      return http(asked);
    },
    connect: (_url, headers) => {
      const fake = new FakeSocket(headers, answer, quoteProfile(rates));

      sockets.push(fake);

      return fake;
    },
    onRateLimited: (error) => rateLimited.push(error),
  });

  const listing = (symbol = "AAPL.US") =>
    longbridge.request(
      Command.QuerySecurityStaticInfo,
      securitiesRequest([symbol])
    );

  return { sockets, passwords, reads, rateLimited, longbridge, listing };
}

const APPLE_INFO = () => ok(staticInfo("AAPL.US", "Apple", "蘋果"));

const fakeClock = () =>
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });

// `expect.poll` moves a fake clock as it waits, so these wait on the real event loop instead.
async function until(done: () => boolean) {
  while (!done()) await new Promise((resolve) => setImmediate(resolve));
}

afterEach(() => {
  vi.useRealTimers();
});

const RATE_LIMITED = () => refused(3, 301_606, "request rate limit");

function staticInfo(symbol: string, nameEn: string, nameHk: string) {
  return new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .fork()
    .tag(1, WireType.LengthDelimited)
    .string(symbol)
    .tag(3, WireType.LengthDelimited)
    .string(nameEn)
    .tag(4, WireType.LengthDelimited)
    .string(nameHk)
    .join()
    .finish();
}

/** A push packet: type, command and length, then the body. */
function pushPacket(command: number, body: Uint8Array) {
  const packet = new Uint8Array(5 + body.length);

  packet[0] = 0x03;
  packet[1] = command;
  packet[2] = (body.length >> 16) & 0xff;
  packet[3] = (body.length >> 8) & 0xff;
  packet[4] = body.length & 0xff;
  packet.set(body, 5);

  return packet.buffer;
}

test("signs in with a one-time password before its first request, and keeps the connection", async () => {
  const { sockets, passwords, listing } = setup(APPLE_INFO);

  await listing();
  await listing();

  expect(passwords).toHaveLength(1);
  expect(passwords[0].headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
  expect(passwords[0].headers.get("x-dc-region")).toBe("ap");

  expect(sockets).toHaveLength(1);
  expect(sockets[0].headers).toEqual({ "x-dc-region": "ap" });

  const [auth, profile, ...asked] = sockets[0].requests;

  expect(auth.command).toBe(2);
  expect(requestFields(auth.body).get(1)).toEqual(["otp-1"]);
  expect(profile.command).toBe(4);
  expect(asked.map(({ command }) => command)).toEqual([10, 10]);
  expect(requestFields(asked[0].body).get(1)).toEqual(["AAPL.US"]);
});

test("a refused request names Longbridge and the reason it gives", async () => {
  const { listing } = setup(() => refused(7, 301_604, "no quote access"));

  const failure = listing();

  await expect(failure).rejects.toThrow(
    "Longbridge refused the request: no quote access"
  );
  await expect(failure).rejects.toMatchObject({
    code: 301_604,
    rateLimited: false,
  });
});

describe("the budget", () => {
  test("a command goes out no faster than the server tells the connection it takes, counted as each goes out", async () => {
    fakeClock();

    const { sockets, listing } = setup(APPLE_INFO, {
      rates: [{ command: 10, limit: 2, burst: 5 }],
    });

    const listings = Promise.all(
      ["AAPL.US", "MSFT.US", "NVDA.US"].map(listing)
    );

    await until(() => (sockets[0] ? askedOf(sockets[0]).length : 0) >= 2);

    // The server counts as requests arrive, so its second is counted a little longer here.
    await vi.advanceTimersByTimeAsync(1099);
    expect(askedOf(sockets[0])).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(1);
    await listings;
    expect(askedOf(sockets[0])).toHaveLength(3);
  });

  test("reads over HTTP and quote requests share ten a second", async () => {
    fakeClock();

    const { sockets, reads, longbridge, listing } = setup(APPLE_INFO);

    // The connection is open, so every request below waits on the budget alone.
    await listing();

    const done = Promise.all([
      longbridge.read("/v1/read", {}, z.unknown(), "a read"),
      ...Array.from({ length: 10 }, () => listing()),
    ]);

    // The listing that opened the connection counts within the same second.
    await until(() => reads.length + askedOf(sockets[0]).length >= 10);
    await vi.advanceTimersByTimeAsync(1098);
    expect(reads.length + askedOf(sockets[0]).length).toBe(10);

    await vi.advanceTimersByTimeAsync(2);
    await done;
    expect(reads.length + askedOf(sockets[0]).length).toBe(12);
  });

  test("reads go out a quarter of a second apart, since Longbridge's HTTP API takes no burst", async () => {
    fakeClock();

    const { reads, longbridge } = setup(() => undefined);

    const done = Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        longbridge.read(`/v1/read/${index}`, {}, z.unknown(), "a read")
      )
    );

    await until(() => reads.length >= 1);
    await vi.advanceTimersByTimeAsync(249);
    expect(reads).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await until(() => reads.length >= 2);
    await vi.advanceTimersByTimeAsync(250);
    await done;
    expect(reads).toHaveLength(3);
  });

  test("no more than five wait for an answer at once, over HTTP and to the quote server alike", async () => {
    let answer: () => void = noop;

    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });

    let answering = true;

    const { sockets, reads, longbridge, listing } = setup(
      () => (answering ? APPLE_INFO() : undefined),
      {
        http: async () => {
          await answered;

          return Response.json({ code: 0, message: "success", data: {} });
        },
      }
    );

    // The connection is open before the read takes its slot.
    await listing();
    answering = false;

    const read = longbridge.read("/v1/read", {}, z.unknown(), "a read");
    const asked = Array.from({ length: 5 }, () => listing());

    await expect.poll(() => askedOf(sockets[0]).length).toBe(5);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(askedOf(sockets[0])).toHaveLength(5);
    expect(reads).toHaveLength(1);

    // The connection dropping fails what it held, so the request waiting goes out on the next.
    answering = true;
    sockets[0].close();

    await Promise.allSettled(asked);
    expect(askedOf(sockets[1])).toHaveLength(1);

    answer();
    await read;
  });

  test("a request refused as too fast is asked again after a pause, and its owner hears of it", async () => {
    fakeClock();

    let refusals = 1;

    const { sockets, rateLimited, listing } = setup(() =>
      refusals-- > 0 ? RATE_LIMITED() : APPLE_INFO()
    );

    const answer = listing();

    await until(() => (sockets[0] ? askedOf(sockets[0]).length : 0) >= 1);
    await vi.advanceTimersByTimeAsync(999);
    expect(askedOf(sockets[0])).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await answer;

    expect(askedOf(sockets[0])).toHaveLength(2);
    expect(rateLimited.map(({ message }) => message)).toEqual([
      "Longbridge refused the request: request rate limit",
    ]);
  });

  test("one still refused after a few pauses fails, naming why", async () => {
    fakeClock();

    const { sockets, listing } = setup(RATE_LIMITED);

    const answer = listing();

    void answer.catch(noop);
    await until(() => (sockets[0] ? askedOf(sockets[0]).length : 0) >= 1);
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 3000 + 4000);

    await expect(answer).rejects.toThrow(
      "Longbridge refused the request: request rate limit"
    );
    await expect(answer).rejects.toMatchObject({ rateLimited: true });
    expect(askedOf(sockets[0])).toHaveLength(5);
  });

  test("a read refused with a 429 holds every read back for the pause its message names", async () => {
    fakeClock();

    const limited =
      "rate limit of 1-second interval has been reached, please retry after: 0.8s";

    let refusals = 1;

    const { reads, rateLimited, longbridge } = setup(() => undefined, {
      http: ({ path }) =>
        path === "/v1/first" && refusals-- > 0
          ? Response.json(
              { code: 429_002, message: limited, data: null },
              { status: 429 }
            )
          : Response.json({ code: 0, message: "success", data: { ok: 1 } }),
    });

    const first = longbridge.read(
      "/v1/first",
      {},
      z.object({ ok: z.number() }),
      "a read"
    );

    await until(() => rateLimited.length >= 1);

    const second = longbridge.read("/v1/second", {}, z.unknown(), "another");

    await vi.advanceTimersByTimeAsync(799);
    expect(reads.map(({ path }) => path)).toEqual(["/v1/first"]);

    await vi.advanceTimersByTimeAsync(1);
    await expect(first).resolves.toEqual({ ok: 1 });
    await vi.advanceTimersByTimeAsync(250);
    await second;
    expect(reads.map(({ path }) => path)).toEqual([
      "/v1/first",
      "/v1/first",
      "/v1/second",
    ]);
    expect(rateLimited.map(({ message }) => message)).toEqual([
      `Longbridge refused a read: ${limited}`,
    ]);
  });

  test("reads Longbridge's pause from its Chinese message too", async () => {
    let refusals = 1;

    const { reads, longbridge } = setup(() => undefined, {
      http: () =>
        refusals-- > 0
          ? Response.json(
              {
                code: 429_001,
                message: "已達到 1S 區間調用上限，請 0 秒後重試",
                data: null,
              },
              { status: 429 }
            )
          : Response.json({ code: 0, message: "success", data: {} }),
    });

    await longbridge.read("/v1/read", {}, z.unknown(), "a read");
    expect(reads).toHaveLength(2);
  });
});

describe("reading over HTTP", () => {
  test("sends the token, its data center and the language, Traditional Chinese unless asked", async () => {
    const { reads, longbridge } = setup(() => undefined);

    await longbridge.read(
      "/v1/quote/a",
      { symbol: "AAPL.US" },
      z.unknown(),
      "a"
    );
    await longbridge.read("/v1/quote/b", {}, z.unknown(), "b", "en");

    expect(reads.map(({ path }) => path)).toEqual([
      "/v1/quote/a",
      "/v1/quote/b",
    ]);
    expect(reads[0].searchParams.get("symbol")).toBe("AAPL.US");
    expect(reads[0].headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(reads[0].headers.get("x-dc-region")).toBe("ap");
    expect(reads[0].headers.get("accept-language")).toBe("zh-HK");
    expect(reads[1].headers.get("accept-language")).toBe("en");
  });

  test("names what it read and why it failed", async () => {
    const { longbridge } = setup(() => undefined, {
      http: ({ path }) =>
        path === "/v1/refused"
          ? Response.json({
              code: 301_600,
              message: "invalid symbol",
              data: null,
            })
          : path === "/v1/odd"
            ? Response.json({ code: 0, message: "success", data: { list: 1 } })
            : new Response("<html>", { status: 502 }),
    });

    await expect(
      longbridge.read("/v1/refused", {}, z.unknown(), "its filings")
    ).rejects.toMatchObject({
      message: "Longbridge refused its filings: invalid symbol",
      code: 301_600,
    });
    await expect(
      longbridge.read(
        "/v1/odd",
        {},
        z.object({ list: z.array(z.unknown()) }),
        "its filings"
      )
    ).rejects.toThrow("Longbridge's its filings did not read");
    await expect(
      longbridge.read("/v1/down", {}, z.unknown(), "its filings")
    ).rejects.toThrow("Longbridge answered its filings with HTTP 502");
  });
});

test("a sign-in Longbridge refuses names its reason", async () => {
  const { sockets, listing } = setup(() => undefined, {
    envelope: { code: 401_003, message: "token expired", data: null },
  });

  const failure = listing();

  await expect(failure).rejects.toThrow(
    "Longbridge refused the sign-in: token expired"
  );
  await expect(failure).rejects.toMatchObject({ code: 401_003 });
  await expect(failure).rejects.toBeInstanceOf(LongbridgeError);
  expect(sockets).toHaveLength(0);
});

test("a connection that closes fails what it was asked, and the next request opens another", async () => {
  let answering = false;

  const { sockets, passwords, listing } = setup(() =>
    answering ? APPLE_INFO() : undefined
  );

  const lost = listing();

  await expect.poll(() => sockets[0]?.requests.length).toBe(3);
  sockets[0].close();

  await expect(lost).rejects.toThrow("Longbridge closed the quote connection");

  answering = true;

  await listing();
  expect(sockets).toHaveLength(2);
  expect(passwords).toHaveLength(2);
});

test("disconnecting closes the connection, and the next request opens another", async () => {
  const { sockets, passwords, longbridge, listing } = setup(APPLE_INFO);

  await listing();
  longbridge.disconnect();
  await expect.poll(() => sockets[0].closed).toBe(true);

  await listing();
  expect(sockets).toHaveLength(2);
  expect(passwords).toHaveLength(2);
});

test("the server closing the connection fails what was asked with the reason it gives", async () => {
  const { sockets, listing } = setup(() => undefined);

  const lost = listing();

  await expect.poll(() => sockets[0]?.requests.length).toBe(3);

  const reason = new BinaryWriter()
    .tag(1, WireType.Varint)
    .int32(5)
    .tag(2, WireType.LengthDelimited)
    .string("session expired")
    .finish();

  sockets[0].emit("message", pushPacket(0, reason));

  await expect(lost).rejects.toThrow(
    "Longbridge closed the quote connection: session expired"
  );
  expect(sockets[0].closed).toBe(true);
});

describe("pushes and drops", () => {
  test("every push reaches the listeners, and a signed-in connection dropping tells them", async () => {
    const { sockets, longbridge, listing } = setup(APPLE_INFO);

    const pushes: [number, number[]][] = [];
    const drops = vi.fn();

    longbridge.onPush((command, body) => pushes.push([command, [...body]]));
    longbridge.onDrop(drops);
    await listing();

    sockets[0].emit("message", pushPacket(104, new Uint8Array([8, 1])));

    expect(pushes).toEqual([[104, [8, 1]]]);
    expect(drops).not.toHaveBeenCalled();

    sockets[0].close();

    expect(drops).toHaveBeenCalledTimes(1);
  });

  test("a connection that never signed in drops without telling them, as it held no subscriptions", async () => {
    const { longbridge, listing } = setup(() => undefined, {
      envelope: { code: 401, message: "token expired", data: null },
    });

    const drops = vi.fn();

    longbridge.onDrop(drops);

    await expect(listing()).rejects.toThrow("token expired");
    expect(drops).not.toHaveBeenCalled();
  });

  test("a heartbeat goes every half a minute, and one left unanswered drops the connection", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });

    let answering = true;

    const { sockets, longbridge, listing } = setup((request) =>
      request.command !== 1 || answering ? APPLE_INFO() : undefined
    );

    const drops = vi.fn();

    longbridge.onDrop(drops);
    await listing();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(sockets[0].requests.map(({ command }) => command)).toEqual([
      2, 4, 10, 1,
    ]);
    expect(drops).not.toHaveBeenCalled();

    answering = false;
    await vi.advanceTimersByTimeAsync(30_000 + 15_000);

    expect(drops).toHaveBeenCalledTimes(1);
    expect(sockets[0].closed).toBe(true);
  });
});

test("nothing is asked once the connection is closed for good", async () => {
  const { longbridge, listing } = setup(() => undefined);

  longbridge.close();

  await expect(listing()).rejects.toThrow("The Longbridge connection closed");
});
