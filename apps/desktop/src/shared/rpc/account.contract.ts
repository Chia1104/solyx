import { oc, type } from "@orpc/contract";

import type { BrokerMode } from "@solyx/core/broker";
import type { AccountSnapshot } from "@solyx/core/order";

export interface AccountSummary extends AccountSnapshot {
  brokerMode: BrokerMode;
}

export const accountContract = {
  summary: oc.output(type<AccountSummary>()),
};
