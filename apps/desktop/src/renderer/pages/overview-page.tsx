import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { symbolKey } from "@solyx/core/market";

import { Section } from "../components/section.tsx";
import { Sheet } from "../components/sheet.tsx";
import { accountQuery } from "../modules/account/account-query.ts";
import { AccountSummary } from "../modules/account/account-summary.tsx";
import { QuoteHeatMap } from "../modules/market/quote-heat-map.tsx";
import { SectorHeatMap } from "../modules/market/sector-heat-map.tsx";
import { watchlistQuery } from "../modules/watchlist/watchlist-query.ts";

/** Today's moves of what the user holds and watches; a listing held and watched shows as held. */
function TodaysMoves() {
  const { t } = useTranslation();
  const account = useQuery(accountQuery());
  const watchlist = useQuery(watchlistQuery());

  const positions = account.data?.positions ?? [];

  const held = new Set(
    positions.map((position) => symbolKey(position.instrument))
  );

  const groups = [
    {
      id: "positions",
      label: t("account.positions"),
      tiles: positions.map((position) => ({
        symbol: {
          market: position.instrument.market,
          symbol: position.instrument.symbol,
        },
        shares: position.quantity,
      })),
    },
    {
      id: "watchlist",
      label: t("watchlist.title"),
      tiles: (watchlist.data ?? [])
        .filter((symbol) => !held.has(symbolKey(symbol)))
        .map((symbol) => ({ symbol })),
    },
  ];

  const loaded = account.data !== undefined && watchlist.data !== undefined;
  const empty = groups.every((group) => group.tiles.length === 0);

  return (
    <Section
      title={t("heat-map.title")}
      description={t("heat-map.description")}>
      {loaded && empty ? (
        <p className="rounded-sm pencil px-3 py-3 text-xs text-muted">
          {t("heat-map.empty")}
        </p>
      ) : (
        <QuoteHeatMap groups={groups} />
      )}
    </Section>
  );
}

export function OverviewPage() {
  const { t } = useTranslation();

  return (
    <Sheet title={t("nav.overview")}>
      <TodaysMoves />
      <Section
        title={t("heat-map.sectors.title")}
        description={t("heat-map.sectors.description")}>
        <SectorHeatMap />
      </Section>
      <AccountSummary />
    </Sheet>
  );
}
