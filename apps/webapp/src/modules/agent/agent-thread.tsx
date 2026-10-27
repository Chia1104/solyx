import { useLayoutEffect, useRef } from "react";

import { Button, ScrollShadow, Spinner } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { AgentView } from "@solyx/agent/wire";

import { inWindow } from "../../app/device.ts";
import { orpc } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";

import { ActivityMark } from "./agent-activity.tsx";
import { transcriptQuery } from "./agent-query.ts";
import { AgentTurn } from "./agent-turn.tsx";
import { threadTurns } from "./agent-turns.ts";
import type { Turn } from "./agent-turns.ts";

// Within this distance of the end, new content keeps the thread scrolled to it.
const PIN_THRESHOLD = 32;

/** Stands where the run's progress would while it waits for the user to try it again or stop it. */
function ParkedRun({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const retry = useMutation(orpc.agent.retry.mutationOptions());

  return (
    <div
      data-activity
      role="status"
      className="flex flex-col items-start gap-2">
      <p className="text-xs text-muted">{t("agent.parked.description")}</p>
      {inWindow ? (
        <Button
          size="sm"
          variant="secondary"
          isPending={retry.isPending}
          onPress={() => retry.mutate(sessionId)}>
          {t("agent.parked.retry")}
        </Button>
      ) : (
        <p className="text-xs text-muted">
          {t("agent.parked.retry-on-computer")}
        </p>
      )}
      {retry.error ? (
        <ErrorAlert
          title={t("agent.parked.retry-failed")}
          description={retry.error.message}
        />
      ) : null}
    </div>
  );
}

export function EmptyThread() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
      <p className="text-sm font-medium">{t("agent.empty-title")}</p>
      <p className="text-xs text-muted">{t("agent.empty-description")}</p>
    </div>
  );
}

/**
 * What a run with no turn of its own yet is doing, such as one resumed before the user wrote, or a
 * summary being written, which has no heading of its own.
 */
function RunActivity({ compacting }: { compacting: boolean }) {
  const { t } = useTranslation();

  return (
    <p
      data-activity
      className="flex min-h-5 items-center gap-2 text-xs text-muted">
      <ActivityMark>
        <Spinner size="sm" color="current" className="size-3" />
      </ActivityMark>
      {compacting ? t("agent.compacting") : t("agent.working")}
    </p>
  );
}

/** The conversation's turns, the one the run works on live, and what else the run is doing. */
function ThreadTurns({
  sessionId,
  view,
}: {
  sessionId: string;
  view: AgentView;
}) {
  const turns = useRef<Turn[]>([]);

  turns.current = threadTurns(view.items, turns.current);

  const last = turns.current.at(-1);
  const live = view.running && !view.parked;
  const compacting = view.compactions.length > 0;

  return (
    <>
      {turns.current.map((turn) => (
        <AgentTurn
          key={turn.key}
          sessionId={sessionId}
          turn={turn}
          live={live && turn === last}
        />
      ))}
      {view.parked ? <ParkedRun sessionId={sessionId} /> : null}
      {compacting || (live && !last) ? (
        <RunActivity compacting={compacting} />
      ) : null}
    </>
  );
}

/** One conversation, kept scrolled to its end while the user reads there. */
export function AgentThread({ sessionId }: { sessionId: string }) {
  const { data, error, refetch } = useQuery(transcriptQuery(sessionId));
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useLayoutEffect(() => {
    const element = scroller.current;

    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [data]);

  if (error) {
    return (
      <div className="p-4">
        <LoadError error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (!data) return <LoadingState />;

  if (data.items.length === 0 && !data.running) return <EmptyThread />;

  return (
    <ScrollShadow
      ref={scroller}
      size={32}
      className="h-full"
      onScroll={(event) => {
        const element = event.currentTarget;

        pinned.current =
          element.scrollHeight - element.scrollTop - element.clientHeight <
          PIN_THRESHOLD;
      }}>
      {/* Messages stand apart; the rows the agent works through (`data-activity`) run together. */}
      <div className="flex flex-col p-4 [&>*+*]:mt-4 [&>[data-activity]+[data-activity]]:mt-1.5">
        <ThreadTurns sessionId={sessionId} view={data} />
      </div>
    </ScrollShadow>
  );
}
