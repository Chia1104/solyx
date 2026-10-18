import { oc, type } from "@orpc/contract";

import type { BrokerOrder } from "@solyx/core/broker";
import type { RoundTrip } from "@solyx/core/review";

import type { AccountSummary } from "../account.ts";

export const accountContract = {
  summary: oc.output(type<AccountSummary>()),
  /** Every round trip the account's fills close, oldest first. */
  roundTrips: oc.output(type<RoundTrip[]>()),
  /** The orders of today's market days that may still fill, oldest first. */
  working: oc.output(type<BrokerOrder[]>()),
};
