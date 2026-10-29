import {
  DashboardSquare01Icon,
  StrategyIcon,
} from "@hugeicons/core-free-icons";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Icon } from "../components/icon.tsx";
import { PANE_LINK, PANE_LINK_ICON } from "../components/pane-link.ts";
import { ListingSearchButton } from "../modules/market/listing-search.tsx";

import { SEARCH_HOTKEY } from "./hotkeys.ts";
import { CategoryLists } from "./symbol-categories.tsx";

/**
 * Where the workspace goes, the search and the overview and strategies pages, over the listings
 * the user follows and holds in the category picked, each opening its chart in the main view.
 */
export function SymbolsPane() {
  const { t } = useTranslation();

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
      <CategoryLists />
    </div>
  );
}
