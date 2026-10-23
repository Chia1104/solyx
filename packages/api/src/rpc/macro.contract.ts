import { oc, type } from "@orpc/contract";

import type { MacroSeries } from "@solyx/core/macro";
import { marketSchema } from "@solyx/core/market";

export const macroContract = {
  /** A market's indicators' figures over the last two years; none for a market no source covers. */
  series: oc.input(marketSchema).output(type<MacroSeries[]>()),
};
