import { useId } from "react";

import { useTranslation } from "react-i18next";

import { ColumnHeader } from "../components/column-header.tsx";
import { PositionList } from "../modules/account/position-list.tsx";
import { Watchlist } from "../modules/watchlist/watchlist.tsx";

/** The listings the user follows and holds, each opening its chart in the main view. */
export function SymbolsPane() {
  const { t } = useTranslation();
  const watchlistId = useId();
  const positionsId = useId();

  return (
    <div className="flex h-full flex-col">
      <ColumnHeader>
        <h2 id={watchlistId} className="text-sm font-semibold">
          {t("watchlist.title")}
        </h2>
      </ColumnHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto py-2">
        <section aria-labelledby={watchlistId}>
          <Watchlist />
        </section>
        <section aria-labelledby={positionsId} className="flex flex-col gap-1">
          <h2 id={positionsId} className="px-4 text-xs font-medium text-muted">
            {t("account.positions")}
          </h2>
          <PositionList />
        </section>
      </div>
    </div>
  );
}
