import type { ReactNode } from "react";

import { Disclosure, Spinner, cn } from "@heroui/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";

import type { MessageView } from "@solyx/agent/wire";

import { Icon } from "../../components/icon.tsx";

import { ActivityMark } from "./agent-activity.tsx";
import { AgentMarkdown } from "./agent-markdown.tsx";
import { CopyAction, EditAction } from "./agent-message-actions.tsx";
import { formatTime, formatFullTime } from "./agent-time.ts";

/** When a message was sent, and its actions, which show while the pointer or focus is on it. */
function MessageMeta({
  at,
  text,
  end = false,
  children,
}: {
  at?: number;
  text: string;
  /** Under a message on the right, the time keeps to the outer edge. */
  end?: boolean;
  children?: ReactNode;
}) {
  const { i18n } = useTranslation();

  return (
    <div
      className={cn(
        "flex h-6 items-center gap-1 text-xs text-muted",
        end && "flex-row-reverse"
      )}>
      {at === undefined ? null : (
        <time
          dateTime={new Date(at).toISOString()}
          title={formatFullTime(at, i18n.language)}
          className="tabular-nums">
          {formatTime(at, i18n.language)}
        </time>
      )}
      <span className="flex items-center opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
        <CopyAction text={text} />
        {children}
      </span>
    </div>
  );
}

export function UserMessage({ message }: { message: MessageView }) {
  return (
    <div className="group/message flex flex-col items-end gap-1">
      <p className="max-w-[85%] rounded-sm bg-surface-secondary px-3 py-2 text-sm leading-6 whitespace-pre-wrap">
        {message.text}
      </p>
      <MessageMeta at={message.at} text={message.text} end>
        <EditAction text={message.text} />
      </MessageMeta>
    </div>
  );
}

/** Thinking folds away under the reply; it opens by itself only while nothing else has streamed. */
function AgentThinking({ message }: { message: MessageView }) {
  const { t } = useTranslation();
  const live = message.streaming && !message.text;

  return (
    <Disclosure
      key={live ? "live" : "done"}
      defaultExpanded={live}
      data-activity>
      <Disclosure.Heading>
        <Disclosure.Trigger className="flex min-h-5 items-center gap-2 text-xs text-muted">
          <ActivityMark>
            {live ? (
              <Spinner size="sm" color="current" className="size-3" />
            ) : (
              <Icon icon={Tick02Icon} className="size-3" />
            )}
          </ActivityMark>
          {live ? t("agent.thinking") : t("agent.thought")}
          <Disclosure.Indicator className="size-3" />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <div className="flex gap-2 pt-1">
          <span aria-hidden className="flex w-3.5 shrink-0 justify-center">
            <span className="border-l border-dashed border-border" />
          </span>
          <p className="min-w-0 text-xs leading-relaxed whitespace-pre-wrap text-muted">
            {message.thinking}
          </p>
        </div>
      </Disclosure.Content>
    </Disclosure>
  );
}

/** Its thinking with the agent's other activity, then the reply standing apart from it. */
export function AssistantMessage({ message }: { message: MessageView }) {
  return (
    <>
      {message.thinking ? <AgentThinking message={message} /> : null}
      {message.text ? (
        <div className="group/message flex flex-col gap-1">
          <AgentMarkdown text={message.text} streaming={message.streaming} />
          {message.streaming ? null : (
            <MessageMeta at={message.at} text={message.text} />
          )}
        </div>
      ) : null}
    </>
  );
}
