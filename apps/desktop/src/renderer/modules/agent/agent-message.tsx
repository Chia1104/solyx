import { Disclosure } from "@heroui/react";
import { useTranslation } from "react-i18next";

import type { MessageView } from "@solyx/agent/wire";

import { AgentMarkdown } from "./agent-markdown.tsx";

export function UserMessage({ message }: { message: MessageView }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-sm bg-surface-secondary px-3 py-2 text-sm leading-6 whitespace-pre-wrap">
        {message.text}
      </p>
    </div>
  );
}

/** Thinking folds away under the reply; it opens by itself only while nothing else has streamed. */
export function AssistantMessage({ message }: { message: MessageView }) {
  const { t } = useTranslation();
  const thinkingOnly = message.streaming && !message.text;

  return (
    <div className="flex flex-col gap-2">
      {message.thinking ? (
        <Disclosure
          key={thinkingOnly ? "live" : "done"}
          defaultExpanded={thinkingOnly}>
          <Disclosure.Heading>
            <Disclosure.Trigger className="flex items-center gap-1 text-xs text-muted">
              {t("agent.thinking")}
              <Disclosure.Indicator />
            </Disclosure.Trigger>
          </Disclosure.Heading>
          <Disclosure.Content>
            <p className="border-l-2 border-dashed border-separator py-1 pl-3 text-xs leading-relaxed whitespace-pre-wrap text-muted">
              {message.thinking}
            </p>
          </Disclosure.Content>
        </Disclosure>
      ) : null}
      {message.text ? (
        <AgentMarkdown text={message.text} streaming={message.streaming} />
      ) : null}
    </div>
  );
}
