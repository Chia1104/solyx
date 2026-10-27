import { describe, expect, test } from "vite-plus/test";

import type { StrategyEntry } from "@solyx/api/strategies";
import { StrategyApprover } from "@solyx/core/strategy";

import {
  StrategyStanding,
  strategyStanding,
} from "../src/modules/strategies/strategy-words.ts";

const approval = (version: string) => ({
  name: "crossing",
  version,
  by: StrategyApprover.User,
  outside: false,
  at: 0,
});

const strategy = (
  allowed: StrategyEntry["allowed"],
  approvals: StrategyEntry["approvals"]
): StrategyEntry => ({
  name: "crossing",
  description: "Holds while the close stands above its own average",
  run: "python3 strategy.py",
  params: {},
  rules: {
    entry: { crossesAbove: [{ line: "close" }, { line: "mean" }] },
    exit: { crossesBelow: [{ line: "close" }, { line: "mean" }] },
  },
  notes: "",
  version: "v2",
  files: [],
  allowed,
  approvals,
});

describe("a strategy's standing", () => {
  test("is allowed where an approval lets it run now, and otherwise says what keeps it from running", () => {
    expect(strategyStanding(strategy(approval("v2"), [approval("v2")]))).toBe(
      StrategyStanding.Allowed
    );
    // Allowed, but for the sandbox while its code would now run outside it.
    expect(strategyStanding(strategy(null, [approval("v2")]))).toBe(
      StrategyStanding.ElsewhereOnly
    );
    expect(strategyStanding(strategy(null, [approval("v1")]))).toBe(
      StrategyStanding.Changed
    );
    expect(strategyStanding(strategy(null, []))).toBe(StrategyStanding.New);
  });
});
