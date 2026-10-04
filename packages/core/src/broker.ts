import type { Market } from "./market.ts";
import type { AccountSnapshot, OrderRequest } from "./order.ts";

export const BrokerMode = {
  Paper: "paper",
  Live: "live",
} as const;

export type BrokerMode = (typeof BrokerMode)[keyof typeof BrokerMode];

/**
 * One implementation per broker (`@solyx/brokers/*`). Only the `OrderDesk` holds one, and nothing
 * outside `OrderDesk.confirm` may call `placeOrder`.
 */
export interface BrokerAdapter {
  readonly id: string;
  readonly mode: BrokerMode;
  readonly markets: readonly Market[];
  getAccount(): Promise<AccountSnapshot>;
  placeOrder(order: OrderRequest): Promise<{ orderId: string }>;
}
