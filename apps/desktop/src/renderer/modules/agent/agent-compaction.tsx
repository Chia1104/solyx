import { Disclosure } from "@heroui/react";
import { useTranslation } from "react-i18next";

import type { CompactionView } from "@solyx/agent/wire";

import { useClock } from "../../app/clock.ts";

import { AgentMarkdown } from "./agent-markdown.tsx";

/**
 * Where a summary took the place of the messages above it in what the agent reads; they stay in
 * the thread, and the summary opens below the rule.
 */
export function CompactionDivider({
  compaction,
}: {
  compaction: CompactionView;
}) {
  const { t } = useTranslation();
  const clock = useClock();

  return (
    <Disclosure>
      <Disclosure.Heading>
        <Disclosure.Trigger className="flex w-full items-center gap-2 text-xs text-muted">
          <span aria-hidden className="h-px flex-1 bg-separator" />
          {t("agent.compaction.summarized")}
          <time
            dateTime={new Date(compaction.at).toISOString()}
            title={clock.fullTime(compaction.at)}
            className="tabular-nums">
            {clock.time(compaction.at)}
          </time>
          <Disclosure.Indicator className="size-3" />
          <span aria-hidden className="h-px flex-1 bg-separator" />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <div className="mt-2 rounded-sm bg-surface-secondary px-3 py-2">
          <AgentMarkdown text={compaction.summary} streaming={false} />
        </div>
      </Disclosure.Content>
    </Disclosure>
  );
}
