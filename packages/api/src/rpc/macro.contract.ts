import { oc, type } from "@orpc/contract";

import type { ExchangeRate } from "@solyx/core/exchange-rate";
import type { MacroSeries } from "@solyx/core/macro";
import { marketSchema } from "@solyx/core/market";
import type { YieldCurve } from "@solyx/core/yields";

import { forDevices } from "./access.ts";

export const macroContract = {
  /** A market's indicators' figures over the last two years; none for a market no source covers. */
  series: oc
    .meta(forDevices(true))
    .input(marketSchema)
    .output(type<MacroSeries[]>()),
  /** The newest close of the US dollar in Taiwan dollars, the last one read while its source fails. */
  exchangeRate: oc.meta(forDevices(true)).output(type<ExchangeRate>()),
  /** US Treasury debt's yield curve at each of about the last three months' closes, oldest first. */
  yields: oc.meta(forDevices(true)).output(type<YieldCurve[]>()),
};
