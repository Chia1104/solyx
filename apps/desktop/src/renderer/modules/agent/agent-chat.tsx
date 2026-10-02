import { useQuery } from "@tanstack/react-query";
import { Link, useMatch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { SymbolRef } from "@solyx/core/market";

import { agentSettingsQuery } from "../settings/settings-query.ts";
import { SettingsSection } from "../settings/settings-section.ts";

import { AgentComposer } from "./agent-composer.tsx";
import { transcriptQuery } from "./agent-query.ts";
import { AgentThread, EmptyThread } from "./agent-thread.tsx";

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

function SessionChat({
  sessionId,
  ready,
  focus,
}: {
  sessionId: string;
  ready: boolean;
  focus: SymbolRef | null;
}) {
  const { data } = useQuery(transcriptQuery(sessionId));

  return (
    <>
      <div className="min-h-0 flex-1">
        <AgentThread key={sessionId} sessionId={sessionId} />
      </div>
      {ready ? (
        <AgentComposer
          sessionId={sessionId}
          running={data?.running ?? false}
          focus={focus}
        />
      ) : (
        <AgentSetup />
      )}
    </>
  );
}

/** The conversation on screen and the box to write in, or setup until the agent can run. */
export function AgentChat({ sessionId }: { sessionId: string | null }) {
  const settings = useQuery(agentSettingsQuery());
  const focus = useFocus();

  // Until the settings load, assume they are ready rather than flash the setup notice.
  const ready = settings.data?.ready ?? true;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {sessionId === null ? (
        <>
          <div className="min-h-0 flex-1">
            <EmptyThread />
          </div>
          {ready ? (
            <AgentComposer sessionId={null} running={false} focus={focus} />
          ) : (
            <AgentSetup />
          )}
        </>
      ) : (
        <SessionChat sessionId={sessionId} ready={ready} focus={focus} />
      )}
    </div>
  );
}
