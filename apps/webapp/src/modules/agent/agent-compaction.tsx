import { useTranslation } from "react-i18next";

import type { CompactionView } from "@solyx/agent/wire";

import { useClock } from "../../app/clock.ts";
import { Expandable } from "../../components/expandable.tsx";

import { AgentMarkdown } from "./agent-markdown.tsx";

// A summary folds down to its opening until the user opens it.
const SUMMARY_MAX_HEIGHT = 160;

/**
 * Where a summary took the place of the messages above it in what the agent reads; they stay in
 * the thread, and the summary follows the rule.
 */
export function CompactionDivider({
  compaction,
}: {
  compaction: CompactionView;
}) {
  const { t } = useTranslation();
  const clock = useClock();

  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2 text-xs text-muted">
        <span aria-hidden className="h-px flex-1 bg-separator" />
        {t("agent.compaction.summarized")}
        <time
          dateTime={new Date(compaction.at).toISOString()}
          title={clock.fullTime(compaction.at)}
          className="tabular-nums">
          {clock.time(compaction.at)}
        </time>
        <span aria-hidden className="h-px flex-1 bg-separator" />
      </p>
      <Expandable
        maxHeight={SUMMARY_MAX_HEIGHT}
        className="rounded-sm bg-surface-secondary px-3 py-2"
        toggleClassName="-mb-1 justify-end pt-1">
        <AgentMarkdown text={compaction.summary} streaming={false} />
      </Expandable>
    </div>
  );
}
