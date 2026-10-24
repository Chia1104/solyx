import type { skipToken } from "@tanstack/react-query";

import type {
  BacktestSetup,
  ScanSetup,
  WalkForwardSetup,
} from "@solyx/api/backtests";

import { orpc } from "../../app/rpc.ts";

// A run is of the bars it read then; running it again is the user's to ask.
export const backtestQuery = (setup: BacktestSetup | typeof skipToken) =>
  orpc.backtests.run.queryOptions({ input: setup, staleTime: Infinity });

export const scanQuery = (setup: ScanSetup | typeof skipToken) =>
  orpc.backtests.scan.queryOptions({ input: setup, staleTime: Infinity });

export const walkForwardQuery = (setup: WalkForwardSetup | typeof skipToken) =>
  orpc.backtests.walkForward.queryOptions({
    input: setup,
    staleTime: Infinity,
  });
