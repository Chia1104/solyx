import { gunzipSync } from "node:zlib";

import { BinaryReader, BinaryWriter, WireType } from "@bufbuild/protobuf/wire";

// Field numbers follow Longbridge's quote protocol as its docs and its SDK (MIT OR Apache-2.0) set
// them; only the messages this client sends or reads are written out.

export const Command = {
  Close: 0,
  Auth: 2,
  QueryMarketTradeDay: 9,
  QuerySecurityStaticInfo: 10,
  QuerySecurityQuote: 11,
  QueryDepth: 14,
  QueryCandlestick: 19,
} as const;

export type Command = (typeof Command)[keyof typeof Command];

export const PacketType = {
  Request: 1,
  Response: 2,
  Push: 3,
} as const;

export type PacketType = (typeof PacketType)[keyof typeof PacketType];

export const ResponseStatus = {
  Success: 0,
  ServerTimeout: 1,
  BadRequest: 3,
  Unauthenticated: 5,
  ServerError: 7,
} as const;

export type ResponseStatus =
  (typeof ResponseStatus)[keyof typeof ResponseStatus];

export const Period = {
  OneMinute: 1,
  FiveMinutes: 5,
  FifteenMinutes: 15,
  ThirtyMinutes: 30,
  OneHour: 60,
  Day: 1000,
} as const;

export type Period = (typeof Period)[keyof typeof Period];

const TYPE_MASK = 0x0f;

const GZIP_FLAG = 0x20;

const REQUEST_HEADER_BYTES = 11;

const RESPONSE_HEADER_BYTES = 10;

const PUSH_HEADER_BYTES = 5;

export type Packet =
  | {
      type: typeof PacketType.Response;
      command: number;
      id: number;
      status: number;
      body: Uint8Array;
    }
  | { type: typeof PacketType.Push; command: number; body: Uint8Array };

function writeUint24(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = (value >> 16) & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = value & 0xff;
}

const readUint24 = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];

/** One request packet: a header of type, command, id, timeout and length, all big-endian, then the body. */
export function encodeRequest({
  command,
  id,
  timeoutMs,
  body,
}: {
  command: Command;
  id: number;
  timeoutMs: number;
  body: Uint8Array;
}): Uint8Array {
  const packet = new Uint8Array(REQUEST_HEADER_BYTES + body.length);
  const view = new DataView(packet.buffer);

  packet[0] = PacketType.Request;
  packet[1] = command;
  view.setUint32(2, id);
  view.setUint16(6, timeoutMs);
  writeUint24(packet, 8, body.length);
  packet.set(body, REQUEST_HEADER_BYTES);

  return packet;
}

function packetBody(
  packet: Uint8Array,
  start: number,
  length: number
): Uint8Array {
  const body = packet.subarray(start, start + length);

  return packet[0] & GZIP_FLAG ? new Uint8Array(gunzipSync(body)) : body;
}

/** A response or push from the server; `undefined` for a packet of any other type, which the client never awaits. */
export function decodePacket(packet: Uint8Array): Packet | undefined {
  const view = new DataView(
    packet.buffer,
    packet.byteOffset,
    packet.byteLength
  );

  const command = packet[1];

  switch (packet[0] & TYPE_MASK) {
    case PacketType.Response:
      return {
        type: PacketType.Response,
        command,
        id: view.getUint32(2),
        status: packet[6],
        body: packetBody(packet, RESPONSE_HEADER_BYTES, readUint24(packet, 7)),
      };
    case PacketType.Push:
      return {
        type: PacketType.Push,
        command,
        body: packetBody(packet, PUSH_HEADER_BYTES, readUint24(packet, 2)),
      };
    default:
      return undefined;
  }
}

/** A message's fields by number, each with every value it carried, read without a schema. */
interface Fields {
  varints: Map<number, bigint[]>;
  bytes: Map<number, Uint8Array[]>;
}

function append<T>(values: Map<number, T[]>, field: number, value: T) {
  values.set(field, [...(values.get(field) ?? []), value]);
}

function readFields(message: Uint8Array): Fields {
  const reader = new BinaryReader(message);
  const fields: Fields = { varints: new Map(), bytes: new Map() };

  while (reader.pos < reader.len) {
    const [field, wireType] = reader.tag();

    if (wireType === WireType.Varint) {
      append(fields.varints, field, BigInt(reader.int64()));
    } else if (wireType === WireType.LengthDelimited) {
      append(fields.bytes, field, reader.bytes());
    } else {
      reader.skip(wireType, field);
    }
  }

  return fields;
}

const utf8 = new TextDecoder();

// Absent fields read as proto3's defaults: an empty string and zero.
const texts = (fields: Fields, field: number) =>
  (fields.bytes.get(field) ?? []).map((value) => utf8.decode(value));

const text = (fields: Fields, field: number) => texts(fields, field)[0] ?? "";

const integer = (fields: Fields, field: number) =>
  Number(fields.varints.get(field)?.[0] ?? 0n);

const messages = (fields: Fields, field: number) =>
  (fields.bytes.get(field) ?? []).map(readFields);

export function authRequest(
  otp: string,
  metadata: Record<string, string>
): Uint8Array {
  const writer = new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string(otp);

  for (const [key, value] of Object.entries(metadata)) {
    writer
      .tag(2, WireType.LengthDelimited)
      .fork()
      .tag(1, WireType.LengthDelimited)
      .string(key)
      .tag(2, WireType.LengthDelimited)
      .string(value)
      .join();
  }

  return writer.finish();
}

/** `MultiSecurityRequest`, or `SecurityRequest` for one symbol: the same field. */
export function securitiesRequest(symbols: readonly string[]): Uint8Array {
  const writer = new BinaryWriter();

  for (const symbol of symbols) {
    writer.tag(1, WireType.LengthDelimited).string(symbol);
  }

  return writer.finish();
}

export function candlesticksRequest({
  symbol,
  period,
  count,
}: {
  symbol: string;
  period: Period;
  count: number;
}): Uint8Array {
  // Adjust type 0 keeps prices as traded, and trade session 0 keeps the regular session alone.
  return new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string(symbol)
    .tag(2, WireType.Varint)
    .int32(period)
    .tag(3, WireType.Varint)
    .int32(count)
    .tag(4, WireType.Varint)
    .int32(0)
    .tag(5, WireType.Varint)
    .int32(0)
    .finish();
}

/** Days are `YYYYMMDD`, at most a month apart and within the last year. */
export function tradeDaysRequest(
  market: string,
  begin: string,
  end: string
): Uint8Array {
  return new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string(market)
    .tag(2, WireType.LengthDelimited)
    .string(begin)
    .tag(3, WireType.LengthDelimited)
    .string(end)
    .finish();
}

/** What a refused request's body carries. */
export function decodeError(body: Uint8Array) {
  const fields = readFields(body);

  return { code: integer(fields, 1), message: text(fields, 2) };
}

/** The reason the server gives as it closes the connection. */
export function decodeClose(body: Uint8Array) {
  const fields = readFields(body);

  return { code: integer(fields, 1), reason: text(fields, 2) };
}

export interface StaticInfo {
  symbol: string;
  nameEn: string;
  /** Its name in traditional Chinese. */
  nameHk: string;
}

export const decodeStaticInfo = (body: Uint8Array): StaticInfo[] =>
  messages(readFields(body), 1).map((info) => ({
    symbol: text(info, 1),
    nameEn: text(info, 3),
    nameHk: text(info, 4),
  }));

/** Prices are decimal text, empty where the security has none. */
export interface SecurityQuote {
  symbol: string;
  lastDone: string;
  prevClose: string;
  open: string;
  high: string;
  low: string;
  /** UTC seconds of its latest trade. */
  timestamp: number;
  volume: number;
  turnover: string;
}

export const decodeQuotes = (body: Uint8Array): SecurityQuote[] =>
  messages(readFields(body), 1).map((quote) => ({
    symbol: text(quote, 1),
    lastDone: text(quote, 2),
    prevClose: text(quote, 3),
    open: text(quote, 4),
    high: text(quote, 5),
    low: text(quote, 6),
    timestamp: integer(quote, 7),
    volume: integer(quote, 8),
    turnover: text(quote, 9),
  }));

export interface DepthLevel {
  position: number;
  price: string;
  volume: number;
}

const depthLevels = (fields: Fields, field: number): DepthLevel[] =>
  messages(fields, field).map((level) => ({
    position: integer(level, 1),
    price: text(level, 2),
    volume: integer(level, 3),
  }));

export function decodeDepth(body: Uint8Array) {
  const fields = readFields(body);

  return { asks: depthLevels(fields, 2), bids: depthLevels(fields, 3) };
}

export interface Candlestick {
  open: string;
  high: string;
  low: string;
  close: string;
  volume: number;
  /** UTC seconds the bar opens at. */
  timestamp: number;
}

export const decodeCandlesticks = (body: Uint8Array): Candlestick[] =>
  messages(readFields(body), 2).map((bar) => ({
    close: text(bar, 1),
    open: text(bar, 2),
    low: text(bar, 3),
    high: text(bar, 4),
    volume: integer(bar, 5),
    timestamp: integer(bar, 7),
  }));

/** Days are `YYYYMMDD`; a day that closes early is listed apart from the full days. */
export function decodeTradeDays(body: Uint8Array) {
  const fields = readFields(body);

  return { trading: texts(fields, 1), halfDays: texts(fields, 2) };
}
