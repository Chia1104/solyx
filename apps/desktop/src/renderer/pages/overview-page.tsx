import type { ReactNode } from "react";

import { Tabs, cn } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { uniqBy } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { Market, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { ROTATION_TRAIL } from "@solyx/core/rotation";
import { isEnumValue } from "@solyx/utils/is";

import { OverviewTab } from "#shared/overview-tab.ts";

import { orpc } from "../app/rpc.ts";
import { LoadingState } from "../components/loading-state.tsx";
import { Section } from "../components/section.tsx";
import { RAILED_COLUMN, Sheet } from "../components/sheet.tsx";
import { AccountSummary } from "../modules/account/account-summary.tsx";
import { TradeReview } from "../modules/account/trade-review.tsx";
import { CALENDAR_DAYS } from "../modules/calendar/calendar-query.ts";
import { UpcomingEvents } from "../modules/calendar/upcoming-events.tsx";
import { MarketFlows } from "../modules/flows/market-flows.tsx";
import { InboxSection } from "../modules/inbox/inbox-section.tsx";
import { QuoteHeatMap } from "../modules/market/quote-heat-map.tsx";
import { SectorHeatMap } from "../modules/market/sector-heat-map.tsx";
import { SectorMovers } from "../modules/market/sector-movers.tsx";
import { SectorRotation } from "../modules/market/sector-rotation.tsx";
import { HeadlineList } from "../modules/news/headline-list.tsx";
import { HEADLINE_DAYS } from "../modules/news/news-query.ts";
import { ThemeList } from "../modules/themes/theme-list.tsx";
import { watchlistQuery } from "../modules/watchlist/watchlist-query.ts";

const route = getRouteApi("/");

/** Today's moves of what the user holds and watches; a listing held and watched shows as held. */
function TodaysMoves() {
  const { t } = useTranslation();
  const account = useQuery(orpc.account.summary.queryOptions());
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
  const account = useQuery(orpc.account.summary.queryOptions());
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

/**
 * What the user holds and watches, a tab for each question asked of it: how it moves today, what
 * is said of it, what comes next and how its market trades. Only the open tab reads its sources.
 */
export function OverviewPage() {
  const { t } = useTranslation();
  const { tab } = route.useSearch();
  const navigate = route.useNavigate();

  const panels: Record<OverviewTab, ReactNode> = {
    [OverviewTab.Today]: (
      <>
        <InboxSection />
        <TodaysMoves />
        <AccountSummary />
        <TradeReview />
      </>
    ),
    [OverviewTab.News]: (
      <>
        <FollowedSection
          title={t("news.headlines.title")}
          description={t("news.headlines.description", {
            days: HEADLINE_DAYS,
          })}
          unfollowed={t("news.headlines.unfollowed")}>
          {(symbols) => <HeadlineList symbols={symbols} />}
        </FollowedSection>
        <Section
          title={t("themes.title")}
          description={t("themes.description")}>
          <ThemeList />
        </Section>
      </>
    ),
    [OverviewTab.Calendar]: (
      <FollowedSection
        title={t("calendar.title")}
        description={t("calendar.description", { days: CALENDAR_DAYS })}
        unfollowed={t("calendar.unfollowed")}>
        {(symbols) => <UpcomingEvents symbols={symbols} />}
      </FollowedSection>
    ),
    [OverviewTab.Market]: (
      <>
        <Section
          title={t("heat-map.sectors.title")}
          description={t("heat-map.sectors.description")}>
          <SectorHeatMap />
        </Section>
        <Section
          title={t("heat-map.movers.title")}
          description={t("heat-map.movers.description")}>
          <SectorMovers />
        </Section>
        <Section
          title={t("heat-map.rotation.title")}
          description={t("heat-map.rotation.description", {
            trail: ROTATION_TRAIL,
          })}>
          <SectorRotation />
        </Section>
        <Section
          title={t("flows.market-title")}
          description={t("flows.market-description")}>
          <MarketFlows market={Market.TW} />
        </Section>
      </>
    ),
  };

  return (
    <Sheet title={t("nav.overview")}>
      <Tabs
        variant="secondary"
        selectedKey={tab}
        onSelectionChange={(key) => {
          if (isEnumValue(OverviewTab, key)) {
            void navigate({ search: { tab: key }, replace: true });
          }
        }}
        className="gap-0">
        {/* HeroUI styles the list through its container as a direct child, so the rails go on the list. */}
        <Tabs.ListContainer className="border-separator">
          {/* A 40px row over its rule, like the agent pane's tabs, so the rules line up across columns. */}
          <Tabs.List
            aria-label={t("nav.overview")}
            className={cn(RAILED_COLUMN, "flex min-w-0 gap-1 px-3")}>
            {Object.values(OverviewTab).map((each) => (
              <Tabs.Tab key={each} id={each} className="h-10 w-auto px-3">
                {t(`overview.tabs.${each}`)}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
        {Object.values(OverviewTab).map((each) => (
          <Tabs.Panel key={each} id={each} className="mt-0 p-0">
            {panels[each]}
          </Tabs.Panel>
        ))}
      </Tabs>
    </Sheet>
  );
}
