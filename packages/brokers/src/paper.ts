import { BrokerMode } from "@solyx/core/broker";
import type { BrokerAdapter } from "@solyx/core/broker";
import { Market, currencyOf, symbolKey } from "@solyx/core/market";
import type { Currency, Instrument } from "@solyx/core/market";
import { OrderType, Side } from "@solyx/core/order";
import type { OrderRequest, Position } from "@solyx/core/order";

export interface PaperBrokerOptions {
  cash: Partial<Record<Currency, number>>;
  /** Only market orders need it; limit orders fill at their limit price. */
  getLastPrice?: (instrument: Instrument) => Promise<number>;
}

/**
 * Fills every order immediately and in full. No fees, no securities transaction tax, no shorting —
 * good enough to exercise the order flow, not to judge a strategy.
 */
export function createPaperBroker(options: PaperBrokerOptions): BrokerAdapter {
  const cash = { ...options.cash };
  const positions = new Map<string, Position>();
  let nextOrderId = 1;

  async function fillPrice(order: OrderRequest): Promise<number> {
    if (order.type === OrderType.Limit) return order.limitPrice;

    if (!options.getLastPrice)
      throw new Error(
        "The paper account has no price source, so it cannot fill market orders"
      );

    return options.getLastPrice(order.instrument);
  }

  return {
    id: "paper",
    mode: BrokerMode.Paper,
    markets: [Market.TW, Market.US],

    async getAccount() {
      return {
        cash: { ...cash },
        positions: [...positions.values()].map((p) => ({ ...p })),
      };
    },

    async placeOrder(order) {
      const price = await fillPrice(order);
      const currency = currencyOf(order.instrument.market);
      const key = symbolKey(order.instrument);
      const held = positions.get(key);
      const notional = price * order.quantity;

      if (order.side === Side.Buy) {
        const available = cash[currency] ?? 0;

        if (notional > available)
          throw new Error(`Insufficient ${currency} in the paper account`);
        cash[currency] = available - notional;
        const quantity = (held?.quantity ?? 0) + order.quantity;
        const cost = (held ? held.avgPrice * held.quantity : 0) + notional;
        positions.set(key, {
          instrument: order.instrument,
          quantity,
          avgPrice: cost / quantity,
        });
      } else {
        if (!held || held.quantity < order.quantity) {
          throw new Error(
            "Not enough shares in the paper account (short selling is not supported)"
          );
        }

        cash[currency] = (cash[currency] ?? 0) + notional;
        const quantity = held.quantity - order.quantity;

        if (quantity === 0) positions.delete(key);
        else positions.set(key, { ...held, quantity });
      }

      return { orderId: `paper-${nextOrderId++}` };
    },

    async cancelOrder() {
      throw new Error(
        "Paper orders fill on submission, so there is nothing to cancel"
      );
    },
  };
}
