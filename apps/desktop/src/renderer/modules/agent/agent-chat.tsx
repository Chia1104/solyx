import { useQuery } from "@tanstack/react-query";
import { Link, useMatch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { AgentView } from "@solyx/agent/wire";
import type { SymbolRef } from "@solyx/core/market";

import { SettingsSection } from "#shared/settings-section.ts";

import { agentSettingsQuery } from "../settings/settings-query.ts";

import { AgentComposer } from "./agent-composer.tsx";
import { transcriptQuery } from "./agent-query.ts";
import { AgentThread, EmptyThread } from "./agent-thread.tsx";

// Streaming replaces the transcript every frame, while the composer needs only this.
const isRunning = (view: AgentView) => view.running;

/** The listing on screen, which the agent is told about with each message. */
function useFocus(): SymbolRef | null {
  const match = useMatch({
    from: "/symbol/$market/$symbol",
    shouldThrow: false,
  });

  return match
    ? { market: match.params.market, symbol: match.params.symbol }
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

/**
 * The conversation on screen and the box to write in, or setup until the agent can run. The
 * composer stays mounted while its first message creates a conversation, so nothing being
 * written is lost.
 */
export function AgentChat({ sessionId }: { sessionId: string | null }) {
  const settings = useQuery(agentSettingsQuery());

  const running = useQuery({
    ...transcriptQuery(sessionId),
    select: isRunning,
  });

  const focus = useFocus();

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
      {ready ? (
        <AgentComposer
          sessionId={sessionId}
          running={running.data ?? false}
          focus={focus}
        />
      ) : (
        <AgentSetup />
      )}
    </div>
  );
}
