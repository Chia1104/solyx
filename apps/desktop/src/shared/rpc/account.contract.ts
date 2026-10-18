import { oc, type } from "@orpc/contract";

import type { RoundTrip } from "@solyx/core/review";

import type { AccountSummary } from "../account.ts";

export const accountContract = {
  summary: oc.output(type<AccountSummary>()),
  /** Every round trip the account's fills close, oldest first. */
  roundTrips: oc.output(type<RoundTrip[]>()),
};
