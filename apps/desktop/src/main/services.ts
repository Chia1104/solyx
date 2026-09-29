import { createPaperBroker } from "@solyx/brokers/paper";
import { OrderDesk } from "@solyx/core/order-desk";
import type { RiskLimits } from "@solyx/core/risk";
import { Session, getSession } from "@solyx/core/session";

const PAPER_CASH = { TWD: 1_000_000, USD: 30_000 };

// Paper trading is allowed around the clock so the flow can be tried after the close.
const PAPER_LIMITS: RiskLimits = {
  maxOrderNotional: PAPER_CASH,
  allowedSessions: Object.values(Session),
};

/** Composition root. A live broker is only ever wired here after the user explicitly turns it on. */
export function createServices() {
  const broker = createPaperBroker({ cash: PAPER_CASH });

  const desk = new OrderDesk({
    broker,
    limits: PAPER_LIMITS,
    // No quote feed yet, so market orders are rejected for lack of a reference price.
    riskContext: async (order) => ({
      session: getSession(order.instrument.market),
    }),
  });

  return { broker, desk };
}

export type Services = ReturnType<typeof createServices>;
