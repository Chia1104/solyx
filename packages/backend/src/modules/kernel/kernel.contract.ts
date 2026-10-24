import { oc, type } from "@orpc/contract";

import type { BacktestColumns, BacktestRun } from "@solyx/kernel/native";

/** What the backend asks of the kernel's process, which keeps nothing between calls. */
export const kernelContract = {
  backtest: oc.input(type<BacktestColumns>()).output(type<BacktestRun>()),
};
