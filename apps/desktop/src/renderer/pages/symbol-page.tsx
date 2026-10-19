import { useEffect, useRef } from "react";

import { ToggleButton, ToggleButtonGroup, Tooltip } from "@heroui/react";
import {
  BarChartHorizontalIcon,
  CrosshairIcon,
} from "@hugeicons/core-free-icons";
import { CatchBoundary, getRouteApi } from "@tanstack/react-router";
import { clamp } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { Interval, isIntraday } from "@solyx/core/candles";
import { Market, symbolKey } from "@solyx/core/market";
import { isEnumValue } from "@solyx/utils/is";

import {
  BOOK_WIDTH,
  NEWS_HEIGHT,
  useLayoutStore,
} from "../app/layout-store.ts";
import { ColumnHeader } from "../components/column-header.tsx";
import { ErrorFallback } from "../components/error-fallback.tsx";
import { Icon } from "../components/icon.tsx";
import {
  PaneSplitter,
  SplitterEdge,
  SplitterOrientation,
} from "../components/pane-splitter.tsx";
import { ListingOrdersPanel } from "../modules/account/listing-orders.tsx";
import { ListingPosition } from "../modules/account/listing-position.tsx";
import { FlowPanes } from "../modules/flows/flow-panes.tsx";
import { ListingFlowsPanel } from "../modules/flows/listing-flows.tsx";
import { ChartKind } from "../modules/market/chart-kind.ts";
import { DepthPanel } from "../modules/market/depth-panel.tsx";
import { IndicatorMenu } from "../modules/market/indicator-menu.tsx";
import { IntervalSelect } from "../modules/market/interval-select.tsx";
import { LowerView } from "../modules/market/lower-view.ts";
import { SymbolChart } from "../modules/market/symbol-chart.tsx";
import { SymbolQuote } from "../modules/market/symbol-quote.tsx";
import { useDepth } from "../modules/market/use-depth.ts";
import { NewsList } from "../modules/news/news-list.tsx";
import { showTicket } from "../modules/proposals/show-ticket.ts";
import { useTicketStore } from "../modules/proposals/ticket-store.ts";
import { TradeOverlay } from "../modules/proposals/trade-overlay.tsx";
import { ForecastOverlay } from "../modules/research/forecast-overlay.tsx";
import { ResearchPanel } from "../modules/research/research-panel.tsx";
import { WatchToggle } from "../modules/watchlist/watch-toggle.tsx";

const route = getRouteApi("/symbol/$market/$symbol");

const NEWS_PANE_ID = "symbol-news";

const BOOK_RAIL_ID = "symbol-book";

/** Dragging the news up stops before the chart gets shorter than this. */
const CHART_MIN_HEIGHT = 160;

/** Widening the book stops before the chart gets narrower than this. */
const CHART_MIN_WIDTH = 320;

const TOOLTIP_DELAY = 600;

/** The switches beside the chart: picking a price on it, and the book. */
const ChartTool = {
  PickPrice: "pick-price",
  Book: "book",
} as const;

type ChartTool = (typeof ChartTool)[keyof typeof ChartTool];

export function SymbolPage() {
  const { t } = useTranslation();
  const symbol = route.useParams();
  const { interval, view: picked, chart } = route.useSearch();
  const session = chart === ChartKind.Session;
  const navigate = route.useNavigate();
  const split = useRef<HTMLDivElement>(null);
  const news = useRef<HTMLDivElement>(null);
  const upper = useRef<HTMLDivElement>(null);
  const book = useRef<HTMLElement>(null);
  const newsHeight = useLayoutStore((state) => state.newsHeight);
  const setNewsHeight = useLayoutStore((state) => state.setNewsHeight);
  const bookWidth = useLayoutStore((state) => state.bookWidth);
  const setBookWidth = useLayoutStore((state) => state.setBookWidth);
  const tradeRail = useLayoutStore((state) => state.tradeRail);
  const toggleTradeRail = useLayoutStore((state) => state.toggleTradeRail);
  const pickPrice = useTicketStore((state) => state.pick);
  const setTicketSymbol = useTicketStore((state) => state.setSymbol);
  const pickingOnChart = useTicketStore((state) => state.pickingOnChart);
  const setPickingOnChart = useTicketStore((state) => state.setPickingOnChart);
  const depth = useDepth(tradeRail || session ? symbol : null);
  const { market, symbol: code } = symbol;

  // The order panel trades the listing on screen until the user names another.
  useEffect(() => {
    setTicketSymbol({ market, symbol: code });
  }, [market, code, setTicketSymbol]);

  const pick = (price: number) => {
    pickPrice(symbol, price);
    showTicket();
  };

  const tools: ChartTool[] = [
    ...(pickingOnChart ? [ChartTool.PickPrice] : []),
    ...(tradeRail ? [ChartTool.Book] : []),
  ];

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
      <ToggleButton id={LowerView.Orders}>{t("account.orders")}</ToggleButton>
    </ToggleButtonGroup>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ColumnHeader className="gap-2 px-6">
        <SymbolQuote symbol={symbol} depth={depth} />
        <WatchToggle symbol={symbol} />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <IntervalSelect
            value={interval}
            kind={chart}
            onChange={(next) =>
              void navigate({
                search: (search) => ({
                  ...search,
                  interval: next.interval,
                  chart: next.kind,
                }),
                replace: true,
              })
            }
          />
          {session ? null : (
            <IndicatorMenu market={symbol.market} interval={interval} />
          )}
          <ToggleButtonGroup
            aria-label={t("chart.tools")}
            selectionMode="multiple"
            size="sm"
            className="shrink-0"
            selectedKeys={tools}
            onSelectionChange={(keys) => {
              setPickingOnChart(keys.has(ChartTool.PickPrice));

              if (keys.has(ChartTool.Book) !== tradeRail) toggleTradeRail();
            }}>
            <Tooltip delay={TOOLTIP_DELAY}>
              <ToggleButton
                isIconOnly
                id={ChartTool.PickPrice}
                aria-label={t("order-form.pick-on-chart")}>
                <Icon icon={CrosshairIcon} />
              </ToggleButton>
              <Tooltip.Content>
                <p className="font-medium">{t("order-form.pick-on-chart")}</p>
                <p className="text-xs">{t("order-form.pick-on-chart-hint")}</p>
              </Tooltip.Content>
            </Tooltip>
            <Tooltip delay={TOOLTIP_DELAY}>
              <ToggleButton
                isIconOnly
                id={ChartTool.Book}
                aria-label={t("depth.book")}
                aria-controls={BOOK_RAIL_ID}>
                <ToggleButtonGroup.Separator />
                <Icon icon={BarChartHorizontalIcon} />
              </ToggleButton>
              <Tooltip.Content>{t("depth.book")}</Tooltip.Content>
            </Tooltip>
          </ToggleButtonGroup>
        </div>
      </ColumnHeader>
      <div ref={split} className="flex min-h-0 flex-1 flex-col">
        {/* The book stands beside the chart alone, so the news below runs the page's full width. */}
        <div
          ref={upper}
          className="flex min-h-40 flex-1 border-b border-separator">
          <div className="min-w-0 flex-1 p-3">
            <SymbolChart
              symbol={symbol}
              interval={interval}
              kind={chart}
              reference={depth?.reference ?? null}
              // A forecast counts sessions, so its paths are drawn on daily bars alone.
              overlay={(candles) => (
                <>
                  {!session && interval === Interval.OneDay ? (
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
          {tradeRail ? (
            <aside
              ref={book}
              id={BOOK_RAIL_ID}
              aria-label={t("depth.book")}
              className="relative shrink-0 border-l border-separator"
              style={{ width: bookWidth }}>
              <PaneSplitter
                edge={SplitterEdge.End}
                label={t("depth.resize")}
                controls={BOOK_RAIL_ID}
                size={bookWidth}
                min={BOOK_WIDTH.min}
                maxSize={() =>
                  clamp(
                    (upper.current?.clientWidth ?? window.innerWidth) -
                      CHART_MIN_WIDTH,
                    BOOK_WIDTH.min,
                    BOOK_WIDTH.max
                  )
                }
                onPreview={(next) => {
                  if (book.current) book.current.style.width = `${next}px`;
                }}
                onCommit={setBookWidth}
                onReset={() => setBookWidth(BOOK_WIDTH.default)}
              />
              <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
                <CatchBoundary
                  getResetKey={() => symbolKey(symbol)}
                  errorComponent={ErrorFallback}>
                  <DepthPanel symbol={symbol} depth={depth} onPick={pick} />
                </CatchBoundary>
                <ListingPosition symbol={symbol} />
              </div>
            </aside>
          ) : null}
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
          {lowerView === LowerView.Orders ? (
            <ListingOrdersPanel symbol={symbol} heading={lowerViews} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
