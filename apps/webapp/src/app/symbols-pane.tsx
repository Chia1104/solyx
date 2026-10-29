import { useId } from "react";

import {
  DashboardSquare01Icon,
  StrategyIcon,
} from "@hugeicons/core-free-icons";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Icon } from "../components/icon.tsx";
import { MarketFilter } from "../components/market-filter.tsx";
import { PANE_LINK, PANE_LINK_ICON } from "../components/pane-link.ts";
import { PositionList } from "../modules/account/position-list.tsx";
import { ListingSearchButton } from "../modules/market/listing-search.tsx";
import { Watchlist } from "../modules/watchlist/watchlist.tsx";

import { SEARCH_HOTKEY } from "./hotkeys.ts";
import { useLayoutStore } from "./layout-store.ts";

/**
 * Where the workspace goes, the search and the overview and strategies pages, over the listings
 * the user follows and holds, in one market or every one, each opening its chart in the main view.
 */
export function SymbolsPane() {
  const { t } = useTranslation();
  const watchlistId = useId();
  const positionsId = useId();
  const market = useLayoutStore((state) => state.symbolsMarket);
  const setMarket = useLayoutStore((state) => state.setSymbolsMarket);

  return (
    <div className="@container/symbols flex h-full flex-col">
      <nav className="flex shrink-0 flex-col gap-1 pt-2">
        <ListingSearchButton hotkey={SEARCH_HOTKEY} />
        <Link
          to="/"
          activeOptions={{ exact: true, includeSearch: false }}
          className={PANE_LINK}>
          <Icon icon={DashboardSquare01Icon} className={PANE_LINK_ICON} />
          {t("nav.overview")}
        </Link>
        <Link
          to="/strategies"
          activeOptions={{ includeSearch: false }}
          className={PANE_LINK}>
          <Icon icon={StrategyIcon} className={PANE_LINK_ICON} />
          {t("nav.strategies")}
        </Link>
      </nav>
      {/* The market picked holds for both lists, so it heads them rather than either. */}
      <MarketFilter
        value={market}
        onChange={setMarket}
        fullWidth
        className="mt-4 shrink-0"
      />
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto py-3">
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
