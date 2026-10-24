import { oc, type } from "@orpc/contract";

import type {
  BacktestRequest,
  BacktestRun,
  RollingRequest,
  RollingRun,
  ScanRequest,
  ScanRun,
  WalkForwardRequest,
  WalkForwardRun,
} from "@solyx/kernel/native";

/** What the backend asks of the kernel's process, which keeps nothing between calls. */
export const kernelContract = {
  backtest: oc.input(type<BacktestRequest>()).output(type<BacktestRun>()),
  scan: oc.input(type<ScanRequest>()).output(type<ScanRun>()),
  walkForward: oc
    .input(type<WalkForwardRequest>())
    .output(type<WalkForwardRun>()),
  rolling: oc.input(type<RollingRequest>()).output(type<RollingRun>()),
};
