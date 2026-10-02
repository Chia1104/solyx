import { useLayoutEffect, useRef } from "react";

import { Spinner } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { AgentItemKind, RunEndReason } from "@solyx/agent/wire";
import type { AgentViewItem, NoticeView } from "@solyx/agent/wire";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";

import { AssistantMessage, UserMessage } from "./agent-message.tsx";
import { transcriptQuery } from "./agent-query.ts";
import { AgentToolCall } from "./agent-tool-call.tsx";

// Within this distance of the end, new content keeps the thread scrolled to it.
const PIN_THRESHOLD = 32;

function Notice({ notice }: { notice: NoticeView }) {
  const { t } = useTranslation();

  if (notice.reason === RunEndReason.Error) {
    return (
      <ErrorAlert title={t("agent.notices.error")} description={notice.error} />
    );
  }

  return (
    <p className="text-xs text-muted">{t(`agent.notices.${notice.reason}`)}</p>
  );
}

function keyOf(item: AgentViewItem, index: number): string {
  switch (item.kind) {
    case AgentItemKind.Tool:
      return item.toolCallId;
    case AgentItemKind.Notice:
      return `notice-${index}`;
    default:
      return item.messageId;
  }
}

function Item({ sessionId, item }: { sessionId: string; item: AgentViewItem }) {
  switch (item.kind) {
    case AgentItemKind.User:
      return <UserMessage message={item} />;
    case AgentItemKind.Assistant:
      return <AssistantMessage message={item} />;
    case AgentItemKind.Tool:
      return <AgentToolCall sessionId={sessionId} tool={item} />;
    default:
      return <Notice notice={item} />;
  }
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

/** One conversation, kept scrolled to its end while the user reads there. */
export function AgentThread({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
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

  const last = data.items.at(-1);

  // A reply that is already writing shows itself; otherwise say the run is still going.
  const working =
    data.running &&
    !(last?.kind === AgentItemKind.Assistant && last.streaming && last.text);

  return (
    <div
      ref={scroller}
      className="h-full overflow-y-auto"
      onScroll={(event) => {
        const element = event.currentTarget;

        pinned.current =
          element.scrollHeight - element.scrollTop - element.clientHeight <
          PIN_THRESHOLD;
      }}>
      <div className="flex flex-col gap-4 px-4 py-4">
        {data.items.map((item, index) => (
          <Item key={keyOf(item, index)} sessionId={sessionId} item={item} />
        ))}
        {working ? (
          <p className="flex items-center gap-2 text-xs text-muted">
            <Spinner size="sm" />
            {t("agent.working")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
