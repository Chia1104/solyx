import { useId } from "react";

import { useTranslation } from "react-i18next";

import { ColumnHeader } from "../components/column-header.tsx";
import { MarketFilter } from "../components/market-filter.tsx";
import { PositionList } from "../modules/account/position-list.tsx";
import { Watchlist } from "../modules/watchlist/watchlist.tsx";

import { useLayoutStore } from "./layout-store.ts";

/** The listings the user follows and holds, in one market or every one, each opening its chart in the main view. */
export function SymbolsPane() {
  const { t } = useTranslation();
  const watchlistId = useId();
  const positionsId = useId();
  const market = useLayoutStore((state) => state.symbolsMarket);
  const setMarket = useLayoutStore((state) => state.setSymbolsMarket);

  return (
    <div className="@container/symbols flex h-full flex-col">
      {/* The market picked holds for both lists, so it heads the pane rather than either. */}
      <ColumnHeader>
        <MarketFilter value={market} onChange={setMarket} fullWidth />
      </ColumnHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto py-2">
        <section aria-labelledby={watchlistId} className="flex flex-col gap-1">
          <h2 id={watchlistId} className="px-4 text-sm font-semibold">
            {t("watchlist.title")}
          </h2>
          <Watchlist market={market} />
        </section>
        <section aria-labelledby={positionsId} className="flex flex-col gap-1">
          <h2 id={positionsId} className="px-4 text-sm font-semibold">
            {t("account.positions")}
          </h2>
          <PositionList market={market} />
        </section>
      </div>
    </div>
  );
}
