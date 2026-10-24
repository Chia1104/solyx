import { Button } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useMatch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { AgentView } from "@solyx/agent/wire";
import { ScreenKind } from "@solyx/api/agent";
import type { AgentScreen } from "@solyx/api/agent";
import { ChartIndicator, offeredIndicators } from "@solyx/api/chart-indicator";
import { SettingsSection } from "@solyx/api/settings-section";
import { Interval } from "@solyx/core/candles";
import { symbolKey } from "@solyx/core/market";

import { client } from "../../app/rpc.ts";
import { PanelView, useBacktestStore } from "../backtests/backtest-store.ts";
import { ChartKind } from "../market/chart-kind.ts";
import { useIndicatorStore } from "../market/indicator-store.ts";
import { LowerView } from "../market/lower-view.ts";
import { agentSettingsQuery } from "../settings/settings-query.ts";

import { AgentComposer } from "./agent-composer.tsx";
import { agentStoreFailedQuery, transcriptQuery } from "./agent-query.ts";
import { AgentThread, EmptyThread } from "./agent-thread.tsx";

// Streaming replaces the transcript every frame, while the composer needs only this.
const isRunning = (view: AgentView) => view.running;

/** What the window shows, which the agent is told about with each message. */
function useScreen(): AgentScreen | null {
  const listing = useMatch({
    from: "/symbol/$market/$symbol",
    shouldThrow: false,
  });

  const overview = useMatch({ from: "/", shouldThrow: false });
  const settings = useMatch({ from: "/settings", shouldThrow: false });
  const enabled = useIndicatorStore((state) => state.enabled);

  // The single run the backtest panel under the chart shows, which the agent can run as it ran.
  const backtest = useBacktestStore((state) => {
    const shown = listing && state.listings[symbolKey(listing.params)];

    return listing?.search.view === LowerView.Backtest &&
      shown?.view === PanelView.Run
      ? shown.run
      : undefined;
  });

  if (listing) {
    const { market, symbol } = listing.params;
    const { interval, chart } = listing.search;
    const offered = offeredIndicators(market, interval);

    // The session chart draws the newest session's minute bars and their VWAP, whatever is picked.
    if (chart === ChartKind.Session) {
      return {
        kind: ScreenKind.Listing,
        symbol: { market, symbol },
        interval: Interval.OneMinute,
        indicators: [ChartIndicator.Vwap],
        backtest,
      };
    }

    return {
      kind: ScreenKind.Listing,
      symbol: { market, symbol },
      interval,
      // An indicator the chart cannot draw on this interval stays switched on but is not shown.
      indicators: enabled.filter((indicator) => offered.includes(indicator)),
      backtest,
    };
  }

  if (overview) return { kind: ScreenKind.Overview, tab: overview.search.tab };

  return settings
    ? { kind: ScreenKind.Settings, section: settings.search.section }
    : null;
}

function AgentSetup() {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 flex-col items-start gap-2 border-t border-separator p-4">
      <p className="text-sm font-medium">{t("agent.setup-title")}</p>
      <p className="text-xs text-muted">{t("agent.setup-description")}</p>
      <Link
        to="/settings"
        search={{ section: SettingsSection.Agent }}
        className="text-sm text-accent underline underline-offset-2">
        {t("agent.open-settings")}
      </Link>
    </div>
  );
}

/** Stands where the composer was once the store failed, since nothing is sent until a restart. */
function AgentStoreFailed() {
  const { t } = useTranslation();

  const restart = useMutation({
    mutationFn: () => client.agent.restart(),
  });

  return (
    <div
      role="alert"
      className="flex shrink-0 flex-col items-start gap-2 border-t border-separator p-4">
      <p className="text-sm font-medium text-danger">
        {t("agent.store-failed.title")}
      </p>
      <p className="text-xs text-muted">
        {t("agent.store-failed.description")}
      </p>
      <Button
        size="sm"
        variant="secondary"
        isPending={restart.isPending}
        onPress={() => restart.mutate()}>
        {t("agent.store-failed.restart")}
      </Button>
    </div>
  );
}

/**
 * The conversation on screen and the box to write in, or setup until the agent can run, or a
 * restart once its store failed. The composer stays mounted while its first message creates a
 * conversation, so nothing being written is lost.
 */
export function AgentChat({ sessionId }: { sessionId: string | null }) {
  const settings = useQuery(agentSettingsQuery());
  const storeFailed = useQuery(agentStoreFailedQuery());

  const running = useQuery({
    ...transcriptQuery(sessionId),
    select: isRunning,
  });

  const screen = useScreen();

  // Until the settings load, assume they are ready rather than flash the setup notice.
  const ready = settings.data?.ready ?? true;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        {sessionId === null ? (
          <EmptyThread />
        ) : (
          <AgentThread key={sessionId} sessionId={sessionId} />
        )}
      </div>
      {storeFailed.data ? (
        <AgentStoreFailed />
      ) : ready ? (
        <AgentComposer
          sessionId={sessionId}
          running={running.data ?? false}
          screen={screen}
        />
      ) : (
        <AgentSetup />
      )}
    </div>
  );
}
