import { useRef } from "react";

import { ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { CatchBoundary, getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Interval, isIntraday } from "@solyx/core/candles";
import { Market, symbolKey } from "@solyx/core/market";
import { isEnumValue } from "@solyx/utils/is";

import { NEWS_HEIGHT, useLayoutStore } from "../app/layout-store.ts";
import { ColumnHeader } from "../components/column-header.tsx";
import { ErrorFallback } from "../components/error-fallback.tsx";
import {
  PaneSplitter,
  SplitterEdge,
  SplitterOrientation,
} from "../components/pane-splitter.tsx";
import { AccountPanel } from "../modules/account/account-panel.tsx";
import { FlowPanes } from "../modules/flows/flow-panes.tsx";
import { ListingFlowsPanel } from "../modules/flows/listing-flows.tsx";
import { DepthPanel } from "../modules/market/depth-panel.tsx";
import { IndicatorMenu } from "../modules/market/indicator-menu.tsx";
import { IntervalSelect } from "../modules/market/interval-select.tsx";
import { LowerView } from "../modules/market/lower-view.ts";
import { SymbolChart } from "../modules/market/symbol-chart.tsx";
import { SymbolQuote } from "../modules/market/symbol-quote.tsx";
import { useDepth } from "../modules/market/use-depth.ts";
import { NewsList } from "../modules/news/news-list.tsx";
import { OrderTicket } from "../modules/proposals/order-ticket.tsx";
import { useTicketStore } from "../modules/proposals/ticket-store.ts";
import { TradeOverlay } from "../modules/proposals/trade-overlay.tsx";
import { ForecastOverlay } from "../modules/research/forecast-overlay.tsx";
import { ResearchPanel } from "../modules/research/research-panel.tsx";
import { WatchToggle } from "../modules/watchlist/watch-toggle.tsx";

const route = getRouteApi("/symbol/$market/$symbol");

const NEWS_PANE_ID = "symbol-news";

const TRADE_RAIL_ID = "symbol-trade";

/** Dragging the news up stops before the chart gets shorter than this. */
const CHART_MIN_HEIGHT = 160;

export function SymbolPage() {
  const { t } = useTranslation();
  const symbol = route.useParams();
  const { interval, view: picked } = route.useSearch();
  const navigate = route.useNavigate();
  const split = useRef<HTMLDivElement>(null);
  const news = useRef<HTMLDivElement>(null);
  const newsHeight = useLayoutStore((state) => state.newsHeight);
  const setNewsHeight = useLayoutStore((state) => state.setNewsHeight);
  const tradeRail = useLayoutStore((state) => state.tradeRail);
  const toggleTradeRail = useLayoutStore((state) => state.toggleTradeRail);
  const pickPrice = useTicketStore((state) => state.pick);
  const pickingOnChart = useTicketStore((state) => state.pickingOnChart);
  const setPickingOnChart = useTicketStore((state) => state.setPickingOnChart);
  const depth = useDepth(symbol, tradeRail);
  // Only Taiwan's exchanges report flows, so a US listing shows the news in their place.
  const flowsShown = symbol.market === Market.TW;

  const lowerView =
    picked === LowerView.Flows && !flowsShown ? LowerView.News : picked;

  const lowerViews = (
    <ToggleButtonGroup
      aria-label={t("research.views-label")}
      selectionMode="single"
      disallowEmptySelection
      size="sm"
      className="shrink-0"
      selectedKeys={[lowerView]}
      onSelectionChange={(keys) => {
        const [next] = keys;

        if (isEnumValue(LowerView, next)) {
          void navigate({
            search: (search) => ({ ...search, view: next }),
            replace: true,
          });
        }
      }}>
      <ToggleButton id={LowerView.News}>{t("news.title")}</ToggleButton>
      <ToggleButton id={LowerView.Research}>{t("research.title")}</ToggleButton>
      {flowsShown ? (
        <ToggleButton id={LowerView.Flows}>{t("flows.title")}</ToggleButton>
      ) : null}
      <ToggleButton id={LowerView.Account}>{t("account.title")}</ToggleButton>
    </ToggleButtonGroup>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ColumnHeader className="px-6">
        <SymbolQuote symbol={symbol} />
        <div className="ml-auto shrink-0">
          <WatchToggle symbol={symbol} />
        </div>
      </ColumnHeader>
      {/* A 40px row over its rule, like the agent pane's tabs, so the rules line up across columns. */}
      <div className="box-content flex h-10 shrink-0 items-center gap-3 border-b border-separator px-6">
        <IntervalSelect
          value={interval}
          onChange={(next) =>
            void navigate({
              search: (search) => ({ ...search, interval: next }),
              replace: true,
            })
          }
        />
        <IndicatorMenu market={symbol.market} interval={interval} />
        {tradeRail ? (
          <ToggleButton
            size="sm"
            className="ml-auto"
            isSelected={pickingOnChart}
            onChange={setPickingOnChart}>
            {t("order-form.pick-on-chart")}
          </ToggleButton>
        ) : null}
        <ToggleButton
          size="sm"
          className={tradeRail ? undefined : "ml-auto"}
          aria-controls={TRADE_RAIL_ID}
          isSelected={tradeRail}
          onChange={toggleTradeRail}>
          {t("order-form.title")}
        </ToggleButton>
      </div>
      <div className="flex min-h-0 flex-1">
        <div ref={split} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-40 flex-1 border-b border-separator p-3">
            <SymbolChart
              symbol={symbol}
              interval={interval}
              // A forecast counts sessions, so its paths are drawn on daily bars alone.
              overlay={(candles) => (
                <>
                  {interval === Interval.OneDay ? (
                    <ForecastOverlay symbol={symbol} candles={candles} />
                  ) : null}
                  <TradeOverlay symbol={symbol} candles={candles} />
                </>
              )}
              // Flows come a session at a time, so they are drawn on daily bars and longer.
              panes={
                flowsShown && !isIntraday(interval)
                  ? (candles, firstPane) => (
                      <FlowPanes
                        symbol={symbol}
                        candles={candles}
                        firstPane={firstPane}
                      />
                    )
                  : undefined
              }
            />
          </div>
          {/* Shrinks before the chart does when the window is too short for both. */}
          <div
            ref={news}
            id={NEWS_PANE_ID}
            className="relative min-h-10"
            style={{ height: newsHeight }}>
            <PaneSplitter
              orientation={SplitterOrientation.Horizontal}
              edge={SplitterEdge.End}
              label={t("news.resize")}
              controls={NEWS_PANE_ID}
              size={newsHeight}
              min={NEWS_HEIGHT.min}
              maxSize={() =>
                Math.max(
                  NEWS_HEIGHT.min,
                  (split.current?.clientHeight ?? window.innerHeight) -
                    CHART_MIN_HEIGHT
                )
              }
              onPreview={(next) => {
                if (news.current) news.current.style.height = `${next}px`;
              }}
              onCommit={setNewsHeight}
              onReset={() => setNewsHeight(NEWS_HEIGHT.default)}
            />
            {lowerView === LowerView.News ? (
              <NewsList symbol={symbol} heading={lowerViews} />
            ) : null}
            {lowerView === LowerView.Research ? (
              <ResearchPanel symbol={symbol} heading={lowerViews} />
            ) : null}
            {lowerView === LowerView.Flows ? (
              <ListingFlowsPanel symbol={symbol} heading={lowerViews} />
            ) : null}
            {lowerView === LowerView.Account ? (
              <AccountPanel heading={lowerViews} />
            ) : null}
          </div>
        </div>
        {tradeRail ? (
          <aside
            id={TRADE_RAIL_ID}
            aria-label={t("order-form.title")}
            className="flex w-64 shrink-0 flex-col gap-5 overflow-y-auto border-l border-separator p-4">
            <CatchBoundary
              getResetKey={() => symbolKey(symbol)}
              errorComponent={ErrorFallback}>
              <DepthPanel
                symbol={symbol}
                depth={depth}
                onPick={(price) => pickPrice(symbol, price)}
              />
            </CatchBoundary>
            <OrderTicket
              key={symbolKey(symbol)}
              symbol={symbol}
              depth={depth}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
