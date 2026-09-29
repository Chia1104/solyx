import type { BrokerMode } from "@solyx/core/broker";
import type { AccountSnapshot } from "@solyx/core/order";

export interface AccountSummary extends AccountSnapshot {
  brokerMode: BrokerMode;
}

export interface AccountApi {
  summary(): Promise<AccountSummary>;
}

export const accountChannels = {
  summary: "account:summary",
} as const satisfies Record<keyof AccountApi, string>;
