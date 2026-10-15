import type { BrokerMode } from "@solyx/core/broker";
import type { AccountSnapshot } from "@solyx/core/order";

export interface AccountSummary extends AccountSnapshot {
  brokerMode: BrokerMode;
}
