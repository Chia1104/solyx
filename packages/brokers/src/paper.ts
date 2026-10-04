import { BrokerMode } from "@solyx/core/broker";
import type { BrokerAdapter } from "@solyx/core/broker";
import { Market, currencyOf, symbolKey } from "@solyx/core/market";
import type { Currency, Instrument } from "@solyx/core/market";
import { OrderType, Side } from "@solyx/core/order";
import type { AccountSnapshot, OrderRequest } from "@solyx/core/order";

export interface PaperAccount extends AccountSnapshot {
  /** Orders filled so far, which numbers the next one. */
  orders: number;
}

/**
 * Where the paper account is kept, so it outlives the app as its proposals do. Synchronous, so an
 * order reads and writes the account with no other order in between.
 */
export interface PaperLedger {
  /** `undefined` before the account's first order. */
  read(): PaperAccount | undefined;
  write(account: PaperAccount): void;
}

export interface PaperBrokerOptions {
  /** What the account opens with. */
  cash: Partial<Record<Currency, number>>;
  ledger: PaperLedger;
  /** Only market orders need it; limit orders fill at their limit price. */
  getLastPrice?: (instrument: Instrument) => Promise<number>;
}

/**
 * Fills every order immediately and in full. No fees, no securities transaction tax, no shorting —
 * good enough to exercise the order flow, not to judge a strategy.
 */
export function createPaperBroker(options: PaperBrokerOptions): BrokerAdapter {
  const account = (): PaperAccount =>
    options.ledger.read() ?? {
      cash: { ...options.cash },
      positions: [],
      orders: 0,
    };

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
      const { cash, positions } = account();

      return { cash, positions };
    },

    async placeOrder(order) {
      const price = await fillPrice(order);
      const { cash, positions: held, orders } = account();
      const currency = currencyOf(order.instrument.market);
      const key = symbolKey(order.instrument);

      const positions = new Map(
        held.map((position) => [symbolKey(position.instrument), position])
      );

      const position = positions.get(key);
      const notional = price * order.quantity;

      if (order.side === Side.Buy) {
        const available = cash[currency] ?? 0;

        if (notional > available)
          throw new Error(`Insufficient ${currency} in the paper account`);
        cash[currency] = available - notional;
        const quantity = (position?.quantity ?? 0) + order.quantity;

        const cost =
          (position ? position.avgPrice * position.quantity : 0) + notional;

        positions.set(key, {
          instrument: order.instrument,
          quantity,
          avgPrice: cost / quantity,
        });
      } else {
        if (!position || position.quantity < order.quantity) {
          throw new Error(
            "Not enough shares in the paper account (short selling is not supported)"
          );
        }

        cash[currency] = (cash[currency] ?? 0) + notional;
        const quantity = position.quantity - order.quantity;

        if (quantity === 0) positions.delete(key);
        else positions.set(key, { ...position, quantity });
      }

      options.ledger.write({
        cash,
        positions: [...positions.values()],
        orders: orders + 1,
      });

      return { orderId: `paper-${orders + 1}` };
    },
  };
}
