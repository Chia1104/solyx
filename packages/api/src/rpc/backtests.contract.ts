import { oc, type } from "@orpc/contract";

import type {
  BacktestResult,
  BacktestScan,
  WalkForwardResult,
} from "@solyx/core/backtest";

import {
  backtestSetupSchema,
  scanSetupSchema,
  walkForwardSetupSchema,
} from "../backtests.ts";

import { forDevices } from "./access.ts";

// A backtest reads bars the app keeps and changes nothing, so a paired device runs one too.
export const backtestsContract = {
  /** A strategy over a listing's last years of bars, its timing tested in and out of sample. */
  run: oc
    .meta(forDevices(true))
    .input(backtestSetupSchema)
    .output(type<BacktestResult>()),
  /** Every setup of a grid over the same bars, and the plateau of their in-sample Sharpe ratios. */
  scan: oc
    .meta(forDevices(true))
    .input(scanSetupSchema)
    .output(type<BacktestScan>()),
  /** A grid picked from on each window's training and run on the sessions after, as one record. */
  walkForward: oc
    .meta(forDevices(true))
    .input(walkForwardSetupSchema)
    .output(type<WalkForwardResult>()),
};
