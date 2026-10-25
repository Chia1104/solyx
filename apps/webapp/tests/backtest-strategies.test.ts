import { expect, test } from "vite-plus/test";

import { BacktestMode, gridCellSetups } from "@solyx/api/backtests";
import { Interval } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";

import {
  StrategyChoice,
  formRequest,
  formValues,
} from "../src/modules/backtests/backtest-form-values.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const OWN = { name: "atr-breakout", params: { period: 20, k: 1.5 } };

const RUN = {
  symbol: TSMC,
  interval: Interval.OneDay,
  years: 5,
  strategy: OWN,
  split: 2 / 3,
};

test("a run of the user's strategy opens in the form with its numbers, and runs as it was", () => {
  const values = formValues(TSMC, RUN);

  expect(values).toMatchObject({
    strategy: StrategyChoice.Own,
    own: "atr-breakout",
    params: { period: 20, k: 1.5 },
  });
  expect(formRequest(BacktestMode.Run, TSMC, values)).toMatchObject({
    mode: BacktestMode.Run,
    setup: { strategy: OWN, years: 5, split: 2 / 3 },
  });
});

test("a scan of the user's strategy runs along two of its numbers, each cell its numbers and the rest as set", () => {
  const values = {
    ...formValues(TSMC, RUN),
    rows: { param: "period", from: 10, to: 30, step: 10 },
    columns: { param: "k", from: 1, to: 2, step: 0.5 },
  };

  const request = formRequest(BacktestMode.Scan, TSMC, values);

  expect(request).toMatchObject({
    mode: BacktestMode.Scan,
    setup: { strategy: OWN, rows: values.rows, columns: values.columns },
  });

  if (request.mode !== BacktestMode.Scan) throw new Error("Not a scan");

  const { strategy, rows, columns } = request.setup;

  expect(
    gridCellSetups(strategy, rows, columns).map((cell) => cell.params)
  ).toEqual([
    { period: 10, k: 1 },
    { period: 10, k: 1.5 },
    { period: 10, k: 2 },
    { period: 20, k: 1 },
    { period: 20, k: 1.5 },
    { period: 20, k: 2 },
    { period: 30, k: 1 },
    { period: 30, k: 1.5 },
    { period: 30, k: 2 },
  ]);
});
