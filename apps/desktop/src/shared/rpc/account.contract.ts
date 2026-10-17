import { oc, type } from "@orpc/contract";

import type { AccountSummary } from "../account.ts";

export const accountContract = {
  summary: oc.output(type<AccountSummary>()),
};
