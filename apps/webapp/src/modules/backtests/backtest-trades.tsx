import { ListLayout, Virtualizer, cn } from "@heroui/react";
import { GridList, GridListItem } from "react-aria-components";
import { useTranslation } from "react-i18next";

import type { BacktestTrade } from "@solyx/core/backtest";
import type { Market } from "@solyx/core/market";

import { numberFormats } from "../market/number-formats.ts";
import { useDirectionColors } from "../market/price-colors.ts";

const ROW = "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem_4rem] gap-3 px-3";

/**
 * A run's trades, newest first: when each bought and sold and at what, and what it made after
 * costs. A run on minute bars trades thousands of times, so only the rows in view are rendered.
 */
export function BacktestTrades({
  market,
  trades,
}: {
  market: Market;
  trades: BacktestTrade[];
}) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);
  const direction = useDirectionColors(market);

  if (trades.length === 0) {
    return (
      <p className="text-sm text-muted">{t("backtests.report.no-trades")}</p>
    );
  }

  const items = trades
    .map((trade, index) => ({ id: index, trade }))
    .toReversed();

  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium text-muted">
        {t("backtests.report.trades", { count: trades.length })}
      </h4>
      <div role="presentation" className={cn(ROW, "text-xs text-muted")}>
        <span>{t("backtests.report.trade.entry")}</span>
        <span>{t("backtests.report.trade.exit")}</span>
        <span className="text-end">{t("backtests.report.trade.return")}</span>
        <span className="text-end">{t("backtests.report.trade.bars")}</span>
      </div>
      <div className="h-56 overflow-y-auto well">
        <Virtualizer
          layout={ListLayout}
          layoutOptions={{ estimatedRowSize: 40 }}>
          <GridList
            aria-label={t("backtests.report.trades", { count: trades.length })}
            items={items}
            className="outline-none">
            {({ trade }) => (
              <GridListItem
                textValue={trade.entryTime}
                className={cn(
                  ROW,
                  "items-baseline py-1.5 text-sm tabular-nums outline-none data-focus-visible:bg-default"
                )}>
                <span className="flex flex-col">
                  {trade.entryTime}
                  <span className="text-xs text-muted">
                    {format.price.format(trade.entryPrice)}
                  </span>
                </span>
                <span className="flex flex-col">
                  {trade.exitTime ?? t("backtests.report.trade.held")}
                  <span className="text-xs text-muted">
                    {format.price.format(trade.exitPrice)}
                  </span>
                </span>
                <span
                  className={cn(
                    "text-end",
                    trade.return > 0 && direction.rise.text,
                    trade.return < 0 && direction.fall.text
                  )}>
                  {format.percentChange.format(trade.return)}
                </span>
                <span className="text-end text-muted">
                  {format.amount.format(trade.bars)}
                </span>
              </GridListItem>
            )}
          </GridList>
        </Virtualizer>
      </div>
    </section>
  );
}
