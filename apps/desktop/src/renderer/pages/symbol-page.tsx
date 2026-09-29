import { getRouteApi } from "@tanstack/react-router";

import { ColumnHeader } from "../components/column-header.tsx";
import { IndicatorToggles } from "../modules/market/indicator-toggles.tsx";
import { IntervalSelect } from "../modules/market/interval-select.tsx";
import { SymbolChart } from "../modules/market/symbol-chart.tsx";
import { SymbolQuote } from "../modules/market/symbol-quote.tsx";
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
        <div className="ml-auto shrink-0">
          <WatchToggle symbol={symbol} />
        </div>
      </ColumnHeader>
      <div className="flex flex-wrap items-center gap-3 border-b border-separator px-6 py-2">
        <IntervalSelect
          value={interval}
          onChange={(next) => void navigate({ search: { interval: next } })}
        />
        <IndicatorToggles />
      </div>
      <div className="min-h-0 flex-1 p-3">
        <SymbolChart symbol={symbol} interval={interval} />
      </div>
    </div>
  );
}
