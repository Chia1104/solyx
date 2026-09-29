import { useTranslation } from "react-i18next";

import type { MarketDataPlan } from "@solyx/core/market-data";

/** What a plan lets Solyx do, which it paces itself to. */
export function PlanLimits({ plan }: { plan: MarketDataPlan }) {
  const { t } = useTranslation();

  return t("settings.market-data.limits", {
    symbols: plan.streamSymbols,
    intraday: plan.requestsPerMinute.intraday,
    historical: plan.requestsPerMinute.historical,
  });
}
