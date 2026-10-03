import { getRouteApi } from "@tanstack/react-router";

import { ColumnHeader } from "../components/column-header.tsx";
import { IndicatorToggles } from "../modules/market/indicator-toggles.tsx";
import { IntervalSelect } from "../modules/market/interval-select.tsx";
import { SymbolChart } from "../modules/market/symbol-chart.tsx";
import { SymbolQuote } from "../modules/market/symbol-quote.tsx";
import { NewsList } from "../modules/news/news-list.tsx";
import { SentimentGauge } from "../modules/news/sentiment-gauge.tsx";
import { WatchToggle } from "../modules/watchlist/watch-toggle.tsx";

const route = getRouteApi("/symbol/$market/$symbol");

export function SymbolPage() {
  const symbol = route.useParams();
  const { interval } = route.useSearch();
  const navigate = route.useNavigate();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ColumnHeader className="px-6">
        <SymbolQuote symbol={symbol} />
        <div className="ml-auto flex shrink-0 items-center gap-4">
          <SentimentGauge symbol={symbol} />
          <WatchToggle symbol={symbol} />
        </div>
      </ColumnHeader>
      {/* A 40px row over its rule, like the agent pane's tabs, so the rules line up across columns. */}
      <div className="shrink-0 border-b border-separator">
        <div className="flex min-h-10 flex-wrap items-center gap-3 px-6 py-1.5">
          <IntervalSelect
            value={interval}
            onChange={(next) => void navigate({ search: { interval: next } })}
          />
          <IndicatorToggles />
        </div>
      </div>
      <div className="min-h-0 flex-1 p-3">
        <SymbolChart symbol={symbol} interval={interval} />
      </div>
      <NewsList symbol={symbol} />
    </div>
  );
}
