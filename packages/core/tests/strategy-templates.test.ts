import { describe, expect, test } from "vite-plus/test";

import { kernel } from "@solyx/kernel/kernel";

import { ruleStrategySchema, scanBacktests } from "../src/backtest.ts";
import type { Candle } from "../src/candles.ts";
import { Market } from "../src/market.ts";
import {
  ExitParam,
  GridProblem,
  STRATEGY_TEMPLATES,
  StrategyTemplate,
  axisValues,
  gridProblems,
  gridSetups,
  initialSetup,
  setupRules,
  strategySetupSchema,
  templateSetupSchema,
} from "../src/strategy-templates.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

describe("templates", () => {
  test.each(Object.values(StrategyTemplate))(
    "%s starts from numbers it takes and writes rules the engine reads",
    (template) => {
      const setup = initialSetup(template);

      expect(templateSetupSchema.parse(setup)).toEqual(setup);
      expect(ruleStrategySchema.safeParse(setupRules(setup)).success).toBe(
        true
      );
    }
  );

  test.each(Object.values(StrategyTemplate))(
    "%s's grid runs as a scan",
    (template) => {
      const { rows, columns } = STRATEGY_TEMPLATES[template].grid;

      expect(gridProblems(initialSetup(template), rows, columns)).toEqual([]);
    }
  );

  test("a moving average cross buys as the fast line crosses above the slow one and sells as it crosses back", () => {
    expect(
      setupRules({
        template: StrategyTemplate.MovingAverageCross,
        params: { fast: 5, slow: 20 },
        stopLoss: 0.08,
      })
    ).toEqual({
      entry: { crossesAbove: [{ sma: 5 }, { sma: 20 }] },
      exit: { crossesBelow: [{ sma: 5 }, { sma: 20 }] },
      stopLoss: 0.08,
    });
  });

  test("a setup refuses a number its template does not take, one off its steps and one past its bounds", () => {
    const issues = (params: Record<string, number>, stopLoss?: number) =>
      templateSetupSchema
        .safeParse({
          template: StrategyTemplate.BollingerBreakout,
          params,
          stopLoss,
        })
        .error?.issues.map((issue) => issue.path.join("."));

    expect(issues({ period: 20, width: 2, fast: 5 })).toEqual(["params.fast"]);
    expect(issues({ period: 20, width: 2.05 })).toEqual(["params.width"]);
    expect(issues({ period: 70, width: 2 })).toEqual(["params.period"]);
    expect(issues({ period: 20 })).toEqual(["params.width"]);
    expect(issues({ period: 20, width: 2 }, 0.6)).toEqual(["stopLoss"]);
    expect(issues({ period: 20, width: 2 }, 0.05)).toBeUndefined();
  });

  test("rules written out whole run as they are", () => {
    const rules = {
      entry: { above: [{ price: "close" }, { value: 10 }] },
      exit: { below: [{ price: "close" }, { value: 9 }] },
    };

    const setup = strategySetupSchema.parse({ rules });

    expect(setupRules(setup)).toEqual(rules);
  });
});

describe("grids", () => {
  test("an axis takes the values a person would write, its last included", () => {
    expect(
      axisValues({ param: "width", from: 1.5, to: 2.5, step: 0.5 })
    ).toEqual([1.5, 2, 2.5]);
    expect(
      axisValues({
        param: ExitParam.StopLoss,
        from: 0.04,
        to: 0.16,
        step: 0.02,
      })
    ).toEqual([0.04, 0.06, 0.08, 0.1, 0.12, 0.14, 0.16]);
    expect(axisValues({ param: "fast", from: 5, to: 4, step: 1 })).toEqual([]);
  });

  test("a grid's setups run row by row, its rows' values down and its columns' across", () => {
    const setups = gridSetups(
      initialSetup(StrategyTemplate.MacdCross),
      { param: ExitParam.StopLoss, from: 0.05, to: 0.1, step: 0.05 },
      { param: ExitParam.TakeProfit, from: 0.1, to: 0.3, step: 0.1 }
    );

    expect(
      setups.map(({ stopLoss, takeProfit }) => [stopLoss, takeProfit])
    ).toEqual([
      [0.05, 0.1],
      [0.05, 0.2],
      [0.05, 0.3],
      [0.1, 0.1],
      [0.1, 0.2],
      [0.1, 0.3],
    ]);
  });

  test("a grid names why it would not run", () => {
    const setup = initialSetup(StrategyTemplate.BollingerBreakout);
    const period = { param: "period", from: 10, to: 30, step: 5 };

    expect(gridProblems(setup, period, { ...period, param: "fast" })).toEqual([
      GridProblem.UnknownParam,
    ]);
    expect(gridProblems(setup, period, period)).toEqual([
      GridProblem.SameParam,
    ]);
    expect(
      gridProblems(setup, period, {
        param: "width",
        from: 1,
        to: 3.5,
        step: 0.5,
      })
    ).toEqual([GridProblem.OffBounds]);
    expect(
      gridProblems(
        setup,
        { ...period, from: 5, to: 60, step: 1 },
        {
          param: "width",
          from: 2,
          to: 2,
          step: 1,
        }
      )
    ).toEqual([GridProblem.AxisSize]);
    // Every period and width reads two bands of its own.
    expect(
      gridProblems(
        setup,
        { ...period, from: 10, to: 40, step: 5 },
        { param: "width", from: 1, to: 3, step: 0.5 }
      )
    ).toEqual([GridProblem.TooManySeries]);
  });

  test("a grid's strategies run as a scan in their order", async () => {
    const candles: Candle[] = Array.from({ length: 300 }, (_, index) => {
      const close = 100 + 10 * Math.sin(index / 9);

      return {
        time: Date.UTC(2025, 0, 1) / 1000 + index * 86_400,
        open: close,
        high: close + 1,
        low: close - 1,
        close,
        volume: 1000,
      };
    });

    const setup = initialSetup(StrategyTemplate.MovingAverageCross);
    const rows = { param: "slow", from: 20, to: 40, step: 10 };
    const columns = { param: "fast", from: 5, to: 10, step: 5 };
    const setups = gridSetups(setup, rows, columns);

    const scan = await scanBacktests(
      kernel,
      TSMC,
      candles,
      setups.map(setupRules),
      { columns: axisValues(columns).length }
    );

    expect(scan.cells).toHaveLength(6);
    expect(scan.plateau?.cell).toBeLessThan(6);
  });
});
