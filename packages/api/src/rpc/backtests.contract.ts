import { oc, type } from "@orpc/contract";
import * as z from "zod";

import type {
  BacktestResult,
  BacktestScan,
  RollingResult,
  WalkForwardResult,
} from "@solyx/core/backtest";

import {
  MAX_COMPARED,
  backtestSetupSchema,
  rollingSetupSchema,
  scanSetupSchema,
  walkForwardSetupSchema,
} from "../backtests.ts";
import type { BacktestRecord } from "../backtests.ts";

import { forDevices } from "./access.ts";
import { changesContract } from "./changes.ts";

// A backtest reads bars the app keeps and changes nothing but the history of the workspace's own
// runs, so a paired device runs one too.
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
  /** One setup over windows of the same months, each from holding nothing, beside holding through each. */
  rolling: oc
    .meta(forDevices(true))
    .input(rollingSetupSchema)
    .output(type<RollingResult>()),
  /** The runs windows asked for, newest first, each with how it did when it last ran. */
  history: oc.meta(forDevices(true)).output(type<BacktestRecord[]>()),
  remove: oc.meta(forDevices(true)).input(z.string()).output(type<void>()),
  clear: oc.meta(forDevices(true)).output(type<void>()),
  /** Single runs from the history run again over the bars as they are now, in the order asked. */
  compare: oc
    .meta(forDevices(true))
    .input(z.array(z.string()).min(1).max(MAX_COMPARED))
    .output(type<{ id: string; result: BacktestResult }[]>()),
  /** A run was kept, or one or all of them removed. */
  changes: changesContract,
};
