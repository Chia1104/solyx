import { Button } from "@heroui/react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { RanBacktest } from "@solyx/agent/wire";
import { BacktestMode } from "@solyx/api/backtests";
import type { BacktestSetup } from "@solyx/api/backtests";
import { symbolLabel } from "@solyx/core/market";

import { useAgentDraft } from "../agent/agent-draft.ts";
import { LowerView } from "../market/lower-view.ts";

import { useBacktestStore } from "./backtest-store.ts";
import { panelSetup } from "./ran-backtest.ts";

/** Opens a backtest on its listing's backtest panel and runs it there. */
function useOpenInPanel() {
  const navigate = useNavigate();
  const ask = useBacktestStore((state) => state.ask);

  return (setup: BacktestSetup) => {
    ask({ mode: BacktestMode.Run, setup });

    void navigate({
      to: "/symbol/$market/$symbol",
      params: setup.symbol,
      search: { interval: setup.interval, view: LowerView.Backtest },
    });
  };
}

/** The single backtests a script ran, each opened in the backtest panel to work on further. */
export function RanBacktests({ backtests }: { backtests: RanBacktest[] }) {
  const { t } = useTranslation();
  const open = useOpenInPanel();

  return (
    <div className="flex flex-col items-start gap-1">
      <p className="text-xs text-muted">{t("backtests.bridge.ran")}</p>
      <div className="flex flex-wrap gap-1.5">
        {backtests.map((ran, index) => (
          <Button
            // The same run is kept once, so what it asked for names it.
            key={JSON.stringify(ran)}
            size="sm"
            variant="tertiary"
            onPress={() => open(panelSetup(ran))}>
            {t("backtests.bridge.open", {
              symbol: symbolLabel(ran.symbol),
              index: index + 1,
            })}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted">{t("backtests.bridge.nearest")}</p>
    </div>
  );
}

/**
 * Hands the agent's composer a request to read the backtest the panel shows, in a new
 * conversation the user sends; the message's context carries the backtest as the panel ran it.
 */
export function AskAgent() {
  const { t } = useTranslation();
  const draft = useAgentDraft();

  return (
    <Button
      size="sm"
      variant="secondary"
      onPress={() => draft(t("backtests.bridge.ask-prompt"))}>
      {t("backtests.bridge.ask")}
    </Button>
  );
}
