import type { Market, SymbolRef } from "./market.ts";
import type {
  AccountSnapshot,
  Exit,
  ExitLeg,
  Fill,
  OrderRequest,
} from "./order.ts";

export const BrokerMode = {
  Paper: "paper",
  Live: "live",
} as const;

export type BrokerMode = (typeof BrokerMode)[keyof typeof BrokerMode];

/**
 * What `placeOrder` throws when the broker answered that it did not take the order, so it holds
 * nothing of it. Any other failure leaves whether it took the order unknown.
 */
export class OrderRefusedError extends Error {
  override name = "OrderRefusedError";
}

export const BrokerOrderStatus = {
  /** The broker took it and has yet to hear from the exchange. */
  Pending: "pending",
  /** On the exchange's book, filled in part or not at all. */
  Working: "working",
  Filled: "filled",
  /** It stopped before filling whole, cancelled or left at its session's close; what filled stands. */
  Cancelled: "cancelled",
  /** The exchange or the broker turned it down after the broker took it, so none of it filled. */
  Refused: "refused",
} as const;

export type BrokerOrderStatus =
  (typeof BrokerOrderStatus)[keyof typeof BrokerOrderStatus];

/** An order the account placed, as the broker reports it. */
export interface BrokerOrder {
  /** The broker's id, the one `placeOrder` answered with. */
  id: string;
  /** The tag it was placed with; `null` for one placed without, as outside the app. */
  tag: string | null;
  order: OrderRequest;
  /** Shares filled so far. */
  filled: number;
  status: BrokerOrderStatus;
  /** UTC milliseconds. */
  placedAt: number;
}

/**
 * The id of a broker trading one account of several, `<broker>:<account>`, or the broker's own
 * where it trades one, so proposals and a mandate made on one account never go to another.
 */
export function brokerId(broker: string, account: string | null): string {
  return account === null ? broker : `${broker}:${account}`;
}

/** The broker and account a `brokerId` names. */
export function brokerOfId(id: string): {
  broker: string;
  account: string | null;
} {
  const at = id.indexOf(":");

  return at < 0
    ? { broker: id, account: null }
    : { broker: id.slice(0, at), account: id.slice(at + 1) };
}

const TAG_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const TAG_LENGTH = 6;

/**
 * The tag an order is placed with for `id`, the proposal it comes from, so the desk can find the
 * order again when placing it failed without the broker's answer. Six letters and digits, which
 * every broker's own field for it takes.
 */
export function orderTag(id: string): string {
  // FNV-1a, so the tag needs no runtime's crypto; it only has to tell apart a day's orders.
  let hash = 0x811c9dc5;

  for (const char of id) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  }

  let tag = "";

  for (let digit = 0; digit < TAG_LENGTH; digit += 1) {
    tag += TAG_DIGITS[hash % TAG_DIGITS.length];
    hash = Math.floor(hash / TAG_DIGITS.length);
  }

  return tag;
}

/** One of an exit's legs a broker watches. */
export interface WatchedExitLeg {
  /** The broker's own id for the leg, the one `BrokerExits.place` answered with. */
  ref: string;
  instrument: SymbolRef;
  /** The shares it sells. */
  quantity: number;
  leg: ExitLeg;
  /** The price it sells at once the listing trades at or past it. */
  price: number;
  /** UTC milliseconds. */
  placedAt: number;
}

/** A broker that watches a listing's price itself and sends an exit's sale once it is reached. */
export interface BrokerExits {
  /**
   * Places a leg for each of `exit`'s prices (`exitLegs`), each selling `quantity` of `instrument`
   * once the listing trades at or past its price, from the first day the broker can watch through
   * `exit.until`, and answers with each leg's ref in that order. Places all of them or none:
   * throws `OrderRefusedError` only where the broker surely watches none of them.
   */
  place(
    instrument: SymbolRef,
    quantity: number,
    exit: Exit,
    tag: string
  ): Promise<string[]>;
  /** The legs it watches now, the ones placed outside the app among them. */
  watching(): Promise<WatchedExitLeg[]>;
  /** Stops watching leg `ref`; throws where the broker did not take the request. */
  cancel(ref: string): Promise<void>;
}

/**
 * One implementation per broker (`@solyx/brokers/*`). Only the `OrderDesk` holds one, nothing
 * outside `OrderDesk.confirm` may call `placeOrder` or `exits.place`, and nothing outside
 * `OrderDesk.cancel` and `OrderDesk.cancelExit` may call `cancelOrder` or `exits.cancel`.
 */
export interface BrokerAdapter {
  readonly id: string;
  readonly mode: BrokerMode;
  readonly markets: readonly Market[];
  getAccount(): Promise<AccountSnapshot>;
  /** The account's fills from `since`, UTC milliseconds, on, oldest first. */
  getFills(since: number): Promise<Fill[]>;
  /** The orders the account placed from `since`, UTC milliseconds, on, oldest first. */
  getOrders(since: number): Promise<BrokerOrder[]>;
  /**
   * Places `order` marked with `tag` (`orderTag`). Throws `OrderRefusedError` only where the
   * broker surely holds nothing of the order.
   */
  placeOrder(order: OrderRequest, tag: string): Promise<{ orderId: string }>;
  /**
   * Asks the broker to cancel the account's order `id`, whoever placed it; its orders tell what
   * came of it and what filled first. Throws where the broker did not take the request.
   */
  cancelOrder(id: string): Promise<void>;
  /** Exits the broker watches the price for itself; unset where it watches none. */
  readonly exits?: BrokerExits;
}
