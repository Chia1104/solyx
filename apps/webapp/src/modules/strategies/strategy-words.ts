import { useTranslation } from "react-i18next";

import type { StrategyEntry } from "@solyx/api/strategies";
import type { RuleCondition, RuleSeries } from "@solyx/core/backtest";
import type { StrategyApprover, StrategyReach } from "@solyx/core/strategy";

import { useClock } from "../../app/clock.ts";

/** Where a strategy stands: allowed to run where its code would now, or why not. */
export const StrategyStanding = {
  Allowed: "allowed",
  /** This version was allowed, but not for where its code would run now. */
  ElsewhereOnly: "elsewhere-only",
  /** Its files changed since a version was allowed. */
  Changed: "changed",
  /** No version of it was ever allowed. */
  New: "new",
} as const;

export type StrategyStanding =
  (typeof StrategyStanding)[keyof typeof StrategyStanding];

export function strategyStanding(strategy: StrategyEntry): StrategyStanding {
  if (strategy.allowed) return StrategyStanding.Allowed;

  if (strategy.approvals.some((each) => each.version === strategy.version)) {
    return StrategyStanding.ElsewhereOnly;
  }

  return strategy.approvals.length > 0
    ? StrategyStanding.Changed
    : StrategyStanding.New;
}

/** A strategy's numbers, rules and standing in words. */
export function useStrategyWords() {
  const { t, i18n } = useTranslation();
  const clock = useClock();

  const plain = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 2,
  });

  const percent = new Intl.NumberFormat(i18n.language, {
    style: "percent",
    maximumFractionDigits: 1,
  });

  function series(each: RuleSeries): string {
    if ("line" in each) return each.line;

    if ("value" in each) return plain.format(each.value);

    if ("price" in each) return t(`strategies.rules.price.${each.price}`);

    if ("sma" in each) return `SMA(${each.sma})`;

    if ("ema" in each) return `EMA(${each.ema})`;

    if ("rsi" in each) return `RSI(${each.rsi})`;

    if ("bollinger" in each) {
      return t(`strategies.rules.band.${each.band}`, {
        period: each.bollinger,
        width: plain.format(each.width ?? 2),
      });
    }

    if ("macd" in each) return `MACD ${each.macd}`;

    if ("kd" in each) return `KD ${each.kd.toUpperCase()}`;

    return "highest" in each
      ? t("strategies.rules.highest", { count: each.highest })
      : t("strategies.rules.lowest", { count: each.lowest });
  }

  function condition(each: RuleCondition, nested = false): string {
    if ("all" in each || "any" in each) {
      const parts = "all" in each ? each.all : each.any;

      const joined = parts
        .map((part) => condition(part, true))
        .join(t(`strategies.rules.${"all" in each ? "and" : "or"}`));

      return nested && parts.length > 1 ? `(${joined})` : joined;
    }

    const [kind, [left, right]] =
      "above" in each
        ? (["above", each.above] as const)
        : "below" in each
          ? (["below", each.below] as const)
          : "crossesAbove" in each
            ? (["crossesAbove", each.crossesAbove] as const)
            : (["crossesBelow", each.crossesBelow] as const);

    return t(`strategies.rules.${kind}`, {
      left: series(left),
      right: series(right),
    });
  }

  return {
    /** Each number the code takes, its range and where it starts. */
    params: (strategy: StrategyEntry) =>
      Object.entries(strategy.params).map(([name, param]) =>
        t("strategies.page.param", {
          name,
          min: plain.format(param.min),
          max: plain.format(param.max),
          step: plain.format(param.step),
          initial: plain.format(param.initial),
        })
      ),

    /** What buys, what sells and the stops, each a line. */
    rules: ({ rules }: StrategyEntry) => [
      t("strategies.rules.entry", { condition: condition(rules.entry) }),
      t("strategies.rules.exit", { condition: condition(rules.exit) }),
      ...(rules.stopLoss === undefined
        ? []
        : [
            t("strategies.rules.stop-loss", {
              value: percent.format(rules.stopLoss),
            }),
          ]),
      ...(rules.takeProfit === undefined
        ? []
        : [
            t("strategies.rules.take-profit", {
              value: percent.format(rules.takeProfit),
            }),
          ]),
    ],

    /** Whether it may run where its code would now, and who allowed it when. */
    standing(strategy: StrategyEntry, reach: StrategyReach) {
      const standing = strategyStanding(strategy);

      if (strategy.allowed) {
        return t(`strategies.standing.allowed.${strategy.allowed.by}`, {
          at: clock.time(strategy.allowed.at),
        });
      }

      if (standing === StrategyStanding.ElsewhereOnly) {
        return t(
          reach.live && !reach.sandboxed
            ? "strategies.standing.elsewhere-only-live"
            : "strategies.standing.elsewhere-only"
        );
      }

      return t(
        standing === StrategyStanding.Changed
          ? "strategies.standing.changed"
          : "strategies.standing.new"
      );
    },

    /** Who allowed a version, in a word. */
    approver: (by: StrategyApprover) => t(`strategies.approver.${by}`),
  };
}
