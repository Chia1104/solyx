import type { ReactNode } from "react";

import { useQuery } from "@tanstack/react-query";
import { uniqBy } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { Market, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { LoadingState } from "../components/loading-state.tsx";
import { Section } from "../components/section.tsx";
import { Sheet } from "../components/sheet.tsx";
import { accountQuery } from "../modules/account/account-query.ts";
import { AccountSummary } from "../modules/account/account-summary.tsx";
import { CALENDAR_DAYS } from "../modules/calendar/calendar-query.ts";
import { UpcomingEvents } from "../modules/calendar/upcoming-events.tsx";
import { MarketFlows } from "../modules/flows/market-flows.tsx";
import { QuoteHeatMap } from "../modules/market/quote-heat-map.tsx";
import { SectorHeatMap } from "../modules/market/sector-heat-map.tsx";
import { HeadlineList } from "../modules/news/headline-list.tsx";
import { HEADLINE_DAYS } from "../modules/news/news-query.ts";
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

/**
 * A section about what the user holds and watches, held first and each once, which asks for some
 * while there are none. An account that fails to read leaves the watchlist.
 */
function FollowedSection({
  title,
  description,
  unfollowed,
  children,
}: {
  title: string;
  description: string;
  /** What it shows while the user holds and watches nothing. */
  unfollowed: string;
  /** What it shows of the listings once there are some. */
  children: (symbols: SymbolRef[]) => ReactNode;
}) {
  const account = useQuery(accountQuery());
  const watchlist = useQuery(watchlistQuery());

  const symbols = uniqBy(
    [
      ...(account.data?.positions ?? []).map(
        ({ instrument: { market, symbol } }) => ({ market, symbol })
      ),
      ...(watchlist.data ?? []),
    ],
    symbolKey
  );

  let body = children(symbols);

  if (account.isPending || watchlist.isPending) {
    body = <LoadingState />;
  } else if (symbols.length === 0) {
    body = (
      <p className="rounded-sm pencil px-3 py-3 text-xs text-muted">
        {unfollowed}
      </p>
    );
  }

  return (
    <Section title={title} description={description}>
      {body}
    </Section>
  );
}

export function OverviewPage() {
  const { t } = useTranslation();

  return (
    <Sheet title={t("nav.overview")}>
      <TodaysMoves />
      <FollowedSection
        title={t("news.headlines.title")}
        description={t("news.headlines.description", { days: HEADLINE_DAYS })}
        unfollowed={t("news.headlines.unfollowed")}>
        {(symbols) => <HeadlineList symbols={symbols} />}
      </FollowedSection>
      <FollowedSection
        title={t("calendar.title")}
        description={t("calendar.description", { days: CALENDAR_DAYS })}
        unfollowed={t("calendar.unfollowed")}>
        {(symbols) => <UpcomingEvents symbols={symbols} />}
      </FollowedSection>
      <Section
        title={t("heat-map.sectors.title")}
        description={t("heat-map.sectors.description")}>
        <SectorHeatMap />
      </Section>
      <Section
        title={t("flows.market-title")}
        description={t("flows.market-description")}>
        <MarketFlows market={Market.TW} />
      </Section>
      <AccountSummary />
    </Sheet>
  );
}
