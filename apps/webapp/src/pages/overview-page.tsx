import type { ReactNode } from "react";

import { Tabs } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { OverviewTab, overviewMarket } from "@solyx/api/overview-tab";
import { Market, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { ROTATION_TRAIL } from "@solyx/core/rotation";
import { isEnumValue } from "@solyx/utils/is";

import { orpc } from "../app/rpc.ts";
import { LoadingState } from "../components/loading-state.tsx";
import { MarketFilter } from "../components/market-filter.tsx";
import { Page } from "../components/page.tsx";
import { Section } from "../components/section.tsx";
import { AccountSummary } from "../modules/account/account-summary.tsx";
import { TradeReview } from "../modules/account/trade-review.tsx";
import { CALENDAR_DAYS } from "../modules/calendar/calendar-query.ts";
import { UpcomingEvents } from "../modules/calendar/upcoming-events.tsx";
import { MarketFlows } from "../modules/flows/market-flows.tsx";
import { InboxSection } from "../modules/inbox/inbox-section.tsx";
import { FollowedRotation } from "../modules/market/followed-rotation.tsx";
import { QuoteHeatMap } from "../modules/market/quote-heat-map.tsx";
import { SectorHeatMap } from "../modules/market/sector-heat-map.tsx";
import { SectorMovers } from "../modules/market/sector-movers.tsx";
import { SectorRotation } from "../modules/market/sector-rotation.tsx";
import { HeadlineList } from "../modules/news/headline-list.tsx";
import { HEADLINE_DAYS } from "../modules/news/news-query.ts";
import { ThemeList } from "../modules/themes/theme-list.tsx";
import { useFollowed } from "../modules/watchlist/use-followed.ts";
import { watchlistQuery } from "../modules/watchlist/watchlist-query.ts";

const route = getRouteApi("/");

/** Whether `symbol` is in `market`, every one where it is `null`. */
const inMarket = (market: Market | null) => (symbol: SymbolRef) =>
  market === null || symbol.market === market;

/** Today's moves of what the user holds and watches in `market`; a listing held and watched shows as held. */
function TodaysMoves({ market }: { market: Market | null }) {
  const { t } = useTranslation();
  const account = useQuery(orpc.account.summary.queryOptions());
  const watchlist = useQuery(watchlistQuery());

  const positions = (account.data?.positions ?? []).filter(({ instrument }) =>
    inMarket(market)(instrument)
  );

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
        .filter(inMarket(market))
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
 * A section about what the user holds and watches in `market`, held first and each once, which
 * asks for some while there are none. An account that fails to read leaves the watchlist.
 */
function FollowedSection({
  market,
  title,
  description,
  unfollowed,
  children,
}: {
  market: Market | null;
  title: string;
  description: string;
  /** What it shows while the user holds and watches nothing. */
  unfollowed: string;
  /** What it shows of the listings once there are some. */
  children: (symbols: SymbolRef[]) => ReactNode;
}) {
  const { symbols, pending } = useFollowed(market);

  let body = children(symbols);

  if (pending) {
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

/** How one market trades: its sectors and who trades it, where the app reads them, and what the user follows in it. */
function MarketTab({ market }: { market: Market }) {
  const { t } = useTranslation();

  const followed = (
    <Section
      title={t("heat-map.rotation.followed-title")}
      description={t("heat-map.rotation.followed-description", {
        trail: ROTATION_TRAIL,
      })}>
      <FollowedRotation market={market} />
    </Section>
  );

  if (market !== Market.TW) return followed;

  return (
    <>
      <Section
        title={t("heat-map.sectors.title")}
        description={t("heat-map.sectors.description")}>
        <SectorHeatMap market={market} />
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
      {followed}
      <Section
        title={t("flows.market-title")}
        description={t("flows.market-description")}>
        <MarketFlows market={market} />
      </Section>
    </>
  );
}

/**
 * What the user holds and watches, a tab for each question asked of it: how it moves today, what
 * is said of it, what comes next and how its market trades, in one market or every one. What
 * waits for the user shows whichever is picked. Only the open tab reads its sources.
 */
export function OverviewPage() {
  const { t } = useTranslation();
  const { tab, market } = route.useSearch();
  const navigate = route.useNavigate();
  const shown = overviewMarket(tab, market);

  const panels: Record<OverviewTab, ReactNode> = {
    [OverviewTab.Today]: (
      <>
        <InboxSection />
        <TodaysMoves market={shown} />
        <AccountSummary market={shown} />
        <TradeReview market={shown} />
      </>
    ),
    [OverviewTab.News]: (
      <>
        <FollowedSection
          market={shown}
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
        market={shown}
        title={t("calendar.title")}
        description={t("calendar.description", { days: CALENDAR_DAYS })}
        unfollowed={t("calendar.unfollowed")}>
        {(symbols) => <UpcomingEvents symbols={symbols} />}
      </FollowedSection>
    ),
    [OverviewTab.Market]: <MarketTab market={shown ?? Market.TW} />,
  };

  return (
    <Tabs
      selectedKey={tab}
      onSelectionChange={(key) => {
        if (isEnumValue(OverviewTab, key)) {
          void navigate({
            search: (search) => ({ ...search, tab: key }),
            replace: true,
          });
        }
      }}
      className="gap-0">
      <Page
        title={t("nav.overview")}
        header={
          <Tabs.ListContainer>
            <Tabs.List aria-label={t("nav.overview")}>
              {Object.values(OverviewTab).map((each) => (
                <Tabs.Tab key={each} id={each} className="h-7 w-auto px-3">
                  {t(`overview.tabs.${each}`)}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
        }
        controls={
          <MarketFilter
            value={shown}
            every={tab !== OverviewTab.Market}
            onChange={(picked) =>
              void navigate({
                search: { tab, market: picked ?? undefined },
                replace: true,
              })
            }
          />
        }>
        {Object.values(OverviewTab).map((each) => (
          <Tabs.Panel
            key={each}
            id={each}
            className="mt-0 flex flex-col gap-2 p-0">
            {panels[each]}
          </Tabs.Panel>
        ))}
      </Page>
    </Tabs>
  );
}
