import type { Market } from "./market.ts";
import type { AccountSnapshot, Fill, OrderRequest } from "./order.ts";

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

/**
 * One implementation per broker (`@solyx/brokers/*`). Only the `OrderDesk` holds one, and nothing
 * outside `OrderDesk.confirm` may call `placeOrder`.
 */
export interface BrokerAdapter {
  readonly id: string;
  readonly mode: BrokerMode;
  readonly markets: readonly Market[];
  getAccount(): Promise<AccountSnapshot>;
  /** The account's fills from `since`, UTC milliseconds, on, oldest first. */
  getFills(since: number): Promise<Fill[]>;
  /** Throws `OrderRefusedError` only where the broker surely holds nothing of the order. */
  placeOrder(order: OrderRequest): Promise<{ orderId: string }>;
}
