import { oc, type } from "@orpc/contract";

import { symbolRefSchema } from "@solyx/core/market";
import type { Coverage } from "@solyx/core/research";

import { forDevices } from "./access.ts";
import { changesContract } from "./changes.ts";

export const researchContract = {
  /** A listing's report and forecasts; reading settles the forecasts whose horizon has closed. */
  coverage: oc
    .meta(forDevices(true))
    .input(symbolRefSchema)
    .output(type<Coverage>()),
  /** A report was revised, its falsifiers read against the news, a forecast made or settled, an exchange's day turned or its regular session opened or closed, or all of it cleared. */
  changes: changesContract,
};
