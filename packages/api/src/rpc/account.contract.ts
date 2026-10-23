import { oc, type } from "@orpc/contract";
import * as z from "zod";

import type { BrokerOrder } from "@solyx/core/broker";
import { symbolRefSchema } from "@solyx/core/market";
import type { Fill } from "@solyx/core/order";
import type { RoundTrip } from "@solyx/core/review";

import type { AccountSummary } from "../account.ts";

export const accountContract = {
  summary: oc.output(type<AccountSummary>()),
  /** Every round trip the account's fills close, oldest first. */
  roundTrips: oc.output(type<RoundTrip[]>()),
  /** The account's fills, oldest first, of one listing where it is named. */
  fills: oc.input(symbolRefSchema.optional()).output(type<Fill[]>()),
  /** The orders of today's market days that may still fill, oldest first. */
  working: oc.output(type<BrokerOrder[]>()),
  /** Asks the broker to cancel one of the account's orders, by its id. */
  cancel: oc.input(z.string().min(1)).output(type<void>()),
};
