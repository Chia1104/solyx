import { memo } from "react";

import { Disclosure, Spinner } from "@heroui/react";
import { Clock01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";

import { AgentItemKind, RunEndReason, ToolCallStatus } from "@solyx/agent/wire";
import type { NoticeView } from "@solyx/agent/wire";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { Icon } from "../../components/icon.tsx";

import { ActivityMark } from "./agent-activity.tsx";
import { CompactionDivider } from "./agent-compaction.tsx";
import {
  AgentThinking,
  AssistantReply,
  UserMessage,
} from "./agent-message.tsx";
import { AgentToolCall, Subject, toolLabel } from "./agent-tool-call.tsx";
import {
  StepKind,
  WorkKind,
  currentStep,
  stepCount,
  turnSeconds,
} from "./agent-turns.ts";
import type { Step, Turn, WorkItem } from "./agent-turns.ts";

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

const waits = (step: Step) =>
  step.kind === StepKind.Tool &&
  step.tool.status === ToolCallStatus.AwaitingApproval;

// A call keeps its key from being written to being run, so the label moves on only to a new step.
const stepKey = (step: Step) =>
  step.kind === StepKind.Tool
    ? `${step.tool.toolCallId}${waits(step) ? ":waiting" : ""}`
    : step.kind;

/** What the run is on now, rising into place each time it moves on to another step. */
function StepLabel({ step }: { step: Step }) {
  const { t } = useTranslation();

  let label;

  if (step.kind === StepKind.Tool) {
    label = waits(step) ? (
      t("agent.work.waiting")
    ) : (
      <>
        <span className="shrink-0">{toolLabel(t, step.tool)}</span>
        <Subject tool={step.tool} />
      </>
    );
  } else {
    label = {
      [StepKind.Thinking]: t("agent.thinking"),
      [StepKind.Answering]: t("agent.work.answering"),
      [StepKind.Working]: t("agent.working"),
    }[step.kind];
  }

  return (
    <span aria-live="polite" className="flex min-w-0 overflow-hidden">
      <span
        key={stepKey(step)}
        className="flex min-w-0 animate-[step-in_240ms_var(--ease-out-quint)] motion-reduce:animate-[fade-in_240ms_var(--ease-out-quint)]">
        <span className="flex min-w-0 shimmer items-center gap-1">{label}</span>
      </span>
    </span>
  );
}

function LiveMark({ step }: { step: Step }) {
  return (
    <ActivityMark>
      {waits(step) ? (
        <Icon icon={Clock01Icon} className="size-3" />
      ) : (
        <Spinner size="sm" color="current" className="size-3" />
      )}
    </ActivityMark>
  );
}

/** How much the agent did and how long it took, once the run is over. */
function WorkSummary({ turn }: { turn: Turn }) {
  const { t, i18n } = useTranslation();
  const steps = stepCount(turn);
  const seconds = turnSeconds(turn);

  const took =
    seconds === undefined
      ? undefined
      : Temporal.Duration.from({ seconds })
          .round({ largestUnit: "hours" })
          .toLocaleString(i18n.language, { style: "narrow" });

  return (
    <>
      <ActivityMark>
        <Icon icon={Tick02Icon} className="size-3" />
      </ActivityMark>
      <span className="truncate">
        {steps > 0
          ? t("agent.work.done", { count: steps })
          : t("agent.thought")}
        {took ? ` · ${took}` : null}
      </span>
    </>
  );
}

function WorkRow({ sessionId, work }: { sessionId: string; work: WorkItem }) {
  switch (work.kind) {
    case WorkKind.Thinking:
      return <AgentThinking message={work.message} />;
    case WorkKind.Text:
      return <AssistantReply message={work.message} between />;
    default:
      return <AgentToolCall sessionId={sessionId} tool={work.tool} />;
  }
}

const workKey = (work: WorkItem) =>
  work.kind === WorkKind.Tool
    ? work.tool.toolCallId
    : `${work.kind}-${work.message.messageId}`;

/**
 * What the agent worked through, folded under a heading that says the step it is on while the
 * run goes and how much it did once it is over. Before any of it shows, the heading stands alone.
 */
function TurnWork({
  sessionId,
  turn,
  live,
}: {
  sessionId: string;
  turn: Turn;
  live: boolean;
}) {
  const step = currentStep(turn);

  if (turn.work.length === 0) {
    return live ? (
      <p
        data-activity
        className="flex min-h-5 items-center gap-2 text-xs text-muted">
        <LiveMark step={step} />
        <StepLabel step={step} />
      </p>
    ) : null;
  }

  return (
    <Disclosure data-activity>
      <Disclosure.Heading>
        <Disclosure.Trigger className="flex min-h-5 w-full min-w-0 items-center gap-2 text-left text-xs text-muted">
          {live ? (
            <>
              <LiveMark step={step} />
              <StepLabel step={step} />
            </>
          ) : (
            <WorkSummary turn={turn} />
          )}
          <Disclosure.Indicator className="size-3 shrink-0" />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        {/* Rows the agent worked through run together; what it said between them stands apart. */}
        <div className="flex flex-col pt-1.5 pl-5.5 [&>*+*]:mt-4 [&>[data-activity]+[data-activity]]:mt-1.5">
          {turn.work.map((work) => (
            <WorkRow key={workKey(work)} sessionId={sessionId} work={work} />
          ))}
        </div>
      </Disclosure.Content>
    </Disclosure>
  );
}

/**
 * One exchange: the user's message, the agent's work folded under one heading, the calls that wait
 * on the user or hold something for them, then the answer and how the run ended. Renders again
 * only when its turn changes, since `threadTurns` keeps every other turn's object.
 */
export const AgentTurn = memo(function AgentTurn({
  sessionId,
  turn,
  live,
}: {
  sessionId: string;
  turn: Turn;
  /** The run goes, and this is the turn it works on. */
  live: boolean;
}) {
  return (
    <>
      {turn.user ? <UserMessage message={turn.user} /> : null}
      <TurnWork sessionId={sessionId} turn={turn} live={live} />
      {turn.cards.map((tool) => (
        <AgentToolCall
          key={tool.toolCallId}
          sessionId={sessionId}
          tool={tool}
        />
      ))}
      {turn.answer ? <AssistantReply message={turn.answer} /> : null}
      {turn.after.map((item, index) =>
        item.kind === AgentItemKind.Compaction ? (
          <CompactionDivider key={item.messageId} compaction={item} />
        ) : (
          <Notice key={`notice-${index}`} notice={item} />
        )
      )}
    </>
  );
});
