import { useRef, useState } from "react";

import { ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Interval, isIntraday } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";
import { isEnumValue } from "@solyx/utils/is";

import { NEWS_HEIGHT, useLayoutStore } from "../app/layout-store.ts";
import { ColumnHeader } from "../components/column-header.tsx";
import {
  PaneSplitter,
  SplitterEdge,
  SplitterOrientation,
} from "../components/pane-splitter.tsx";
import { FlowPanes } from "../modules/flows/flow-panes.tsx";
import { ListingFlowsPanel } from "../modules/flows/listing-flows.tsx";
import { IndicatorMenu } from "../modules/market/indicator-menu.tsx";
import { IntervalSelect } from "../modules/market/interval-select.tsx";
import { SymbolChart } from "../modules/market/symbol-chart.tsx";
import { SymbolQuote } from "../modules/market/symbol-quote.tsx";
import { NewsList } from "../modules/news/news-list.tsx";
import { ForecastOverlay } from "../modules/research/forecast-overlay.tsx";
import { ResearchPanel } from "../modules/research/research-panel.tsx";
import { WatchToggle } from "../modules/watchlist/watch-toggle.tsx";

const route = getRouteApi("/symbol/$market/$symbol");

const NEWS_PANE_ID = "symbol-news";

/** What the pane under the chart shows. */
const LowerView = {
  News: "news",
  Research: "research",
  Flows: "flows",
} as const;

type LowerView = (typeof LowerView)[keyof typeof LowerView];

/** Dragging the news up stops before the chart gets shorter than this. */
const CHART_MIN_HEIGHT = 160;

export function SymbolPage() {
  const { t } = useTranslation();
  const symbol = route.useParams();
  const { interval } = route.useSearch();
  const navigate = route.useNavigate();
  const split = useRef<HTMLDivElement>(null);
  const news = useRef<HTMLDivElement>(null);
  const newsHeight = useLayoutStore((state) => state.newsHeight);
  const setNewsHeight = useLayoutStore((state) => state.setNewsHeight);
  const [picked, setLowerView] = useState<LowerView>(LowerView.News);
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

        if (isEnumValue(LowerView, next)) setLowerView(next);
      }}>
      <ToggleButton id={LowerView.News}>{t("news.title")}</ToggleButton>
      <ToggleButton id={LowerView.Research}>{t("research.title")}</ToggleButton>
      {flowsShown ? (
        <ToggleButton id={LowerView.Flows}>{t("flows.title")}</ToggleButton>
      ) : null}
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
            void navigate({ search: { interval: next }, replace: true })
          }
        />
        <IndicatorMenu market={symbol.market} />
      </div>
      <div ref={split} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-40 flex-1 border-b border-separator p-3">
          <SymbolChart
            symbol={symbol}
            interval={interval}
            // A forecast counts sessions, so its paths are drawn on daily bars alone.
            overlay={
              interval === Interval.OneDay
                ? (candles) => (
                    <ForecastOverlay symbol={symbol} candles={candles} />
                  )
                : undefined
            }
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
        </div>
      </div>
    </div>
  );
}
