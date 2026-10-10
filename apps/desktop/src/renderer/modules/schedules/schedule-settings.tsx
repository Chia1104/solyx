import { useMemo, useState } from "react";

import {
  Button,
  Description,
  FieldError,
  Form,
  Input,
  Label,
  Switch,
  TextArea,
  TextField,
} from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { Market, marketSchema } from "@solyx/core/market";
import { holdsSecret } from "@solyx/core/memory";
import {
  SCHEDULE_NAME_LENGTH,
  SCHEDULE_PROMPT_LENGTH,
  ScheduleApproval,
  ScheduleKind,
} from "@solyx/core/schedule";
import type { Schedule, ScheduledTaskDraft } from "@solyx/core/schedule";

import type { ScheduledTaskView } from "#shared/ipc/schedules.ts";

import { currentTimeZone, useClock } from "../../app/clock.ts";
import { currentLocale } from "../../app/i18n.ts";
import { Pane, useLayoutStore } from "../../app/layout-store.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { OptionSelect } from "../../components/option-select.tsx";
import { Section } from "../../components/section.tsx";
import { RailedColumn } from "../../components/sheet.tsx";
import { useAgentStore } from "../agent/agent-store.ts";
import { SettingsList, SettingsRow } from "../settings/settings-list.tsx";

import { schedulesQuery } from "./schedules-query.ts";

// The spans a task may recur at, in minutes.
const INTERVALS = [30, 60, 120, 240, 360, 720, 1440];

const HOUR_MINUTES = 60;

const EVERY_DAY = "every-day";

// Every day, or only the days one market trades.
const DAY_CHOICES: (typeof EVERY_DAY | Market)[] = [
  EVERY_DAY,
  ...Object.values(Market),
];

const DEFAULT_TIME = "08:30";

/** A span as words: minutes below an hour, whole hours from there. */
const everyText = (t: TFunction, minutes: number) =>
  minutes < HOUR_MINUTES
    ? t("settings.schedules.every-minutes", { count: minutes })
    : t("settings.schedules.every-hours", { count: minutes / HOUR_MINUTES });

/** When a task runs, in a line: its span, its time on its own clock and the days it keeps to, or what it waits on. */
function scheduleText(t: TFunction, schedule: Schedule, timeZone: string) {
  switch (schedule.kind) {
    case ScheduleKind.Interval:
      return everyText(t, schedule.everyMinutes);
    case ScheduleKind.FixedTime:
      return t("settings.schedules.at-time", {
        time: schedule.time,
        timeZone,
        days: t(
          `settings.schedules.days.${schedule.tradingDaysOf ?? EVERY_DAY}`
        ),
      });
    case ScheduleKind.OnChange:
      return schedule.atMostEveryMinutes < HOUR_MINUTES
        ? t("settings.schedules.on-change-minutes", {
            count: schedule.atMostEveryMinutes,
          })
        : t("settings.schedules.on-change-hours", {
            count: schedule.atMostEveryMinutes / HOUR_MINUTES,
          });
  }
}

/** A task as its form holds it; rebuilt per language so field errors come out localized. */
function useTaskFormSchema() {
  const { t } = useTranslation();

  return useMemo(() => {
    const text = (max: number) =>
      z
        .string()
        .trim()
        .min(1, { error: t("settings.schedules.required") })
        .max(max, { error: t("settings.schedules.too-long", { count: max }) });

    return z.object({
      name: text(SCHEDULE_NAME_LENGTH),
      prompt: text(SCHEDULE_PROMPT_LENGTH).refine(
        (value) => !holdsSecret(value),
        { error: t("settings.schedules.secret") }
      ),
      kind: z.enum(ScheduleKind),
      everyMinutes: z.number(),
      time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, {
        error: t("settings.schedules.time-required"),
      }),
      days: z.union([z.literal(EVERY_DAY), marketSchema]),
      approval: z.enum(ScheduleApproval),
    });
  }, [t]);
}

type TaskForm = z.infer<ReturnType<typeof useTaskFormSchema>>;

const NEW_TASK: TaskForm = {
  name: "",
  prompt: "",
  kind: ScheduleKind.FixedTime,
  everyMinutes: HOUR_MINUTES,
  time: DEFAULT_TIME,
  days: EVERY_DAY,
  approval: ScheduleApproval.Ask,
};

/** The form's fields a schedule fills; the rest keep what a new task starts with. */
function timingOf(schedule: Schedule): Partial<TaskForm> {
  switch (schedule.kind) {
    case ScheduleKind.Interval:
      return { kind: schedule.kind, everyMinutes: schedule.everyMinutes };
    case ScheduleKind.OnChange:
      return { kind: schedule.kind, everyMinutes: schedule.atMostEveryMinutes };
    case ScheduleKind.FixedTime:
      return {
        kind: schedule.kind,
        time: schedule.time,
        days: schedule.tradingDaysOf ?? EVERY_DAY,
      };
  }
}

const formOf = ({
  name,
  prompt,
  schedule,
  approval,
}: ScheduledTaskDraft): TaskForm => ({
  ...NEW_TASK,
  name,
  prompt,
  approval,
  ...timingOf(schedule),
});

/** The schedule a form describes; its span is how often for an interval and how seldom at least for a change. */
function scheduleOf(form: TaskForm): Schedule {
  switch (form.kind) {
    case ScheduleKind.Interval:
      return { kind: form.kind, everyMinutes: form.everyMinutes };
    case ScheduleKind.OnChange:
      return { kind: form.kind, atMostEveryMinutes: form.everyMinutes };
    case ScheduleKind.FixedTime:
      return {
        kind: form.kind,
        time: form.time,
        tradingDaysOf: form.days === EVERY_DAY ? null : form.days,
      };
  }
}

/**
 * The task a form describes, on the clock and in the language the app shows now: a task saved
 * again follows them, so its time of day reads as the user sees it.
 */
function draftOf(form: TaskForm, enabled: boolean): ScheduledTaskDraft {
  return {
    name: form.name,
    prompt: form.prompt,
    schedule: scheduleOf(form),
    timeZone: currentTimeZone(),
    locale: currentLocale(),
    approval: form.approval,
    enabled,
  };
}

/** Writes a task, new or kept: what to send, when, and how its calls that must ask get past. */
function TaskEditor({
  task,
  onDone,
}: {
  /** The task being edited; none for a new one. */
  task?: ScheduledTaskView;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const clock = useClock();

  const form = useForm({
    resolver: zodResolver(useTaskFormSchema()),
    reValidateMode: "onSubmit",
    defaultValues: task ? formOf(task) : NEW_TASK,
  });

  const kind = useWatch({ control: form.control, name: "kind" });
  const approval = useWatch({ control: form.control, name: "approval" });

  const save = useMutation({
    mutationFn: (values: TaskForm) =>
      task
        ? window.solyx.schedules.update(task.id, draftOf(values, task.enabled))
        : window.solyx.schedules.create(draftOf(values, true)),
    onSuccess: onDone,
  });

  const remove = useMutation({
    mutationFn: (id: string) => window.solyx.schedules.remove(id),
    onSuccess: onDone,
  });

  const submit = form.handleSubmit((values) => save.mutate(values));
  const pending = save.isPending || remove.isPending;
  const error = save.error ?? remove.error;

  return (
    <Form
      validationBehavior="aria"
      className="flex flex-col gap-3"
      onSubmit={(event) => void submit(event)}>
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <TextField isRequired autoFocus isInvalid={fieldState.invalid}>
            <Label>{t("settings.schedules.name")}</Label>
            <Input {...field} autoComplete="off" />
            <FieldError>{fieldState.error?.message}</FieldError>
          </TextField>
        )}
      />
      <Controller
        control={form.control}
        name="prompt"
        render={({ field, fieldState }) => (
          <TextField isRequired isInvalid={fieldState.invalid}>
            <Label>{t("settings.schedules.prompt")}</Label>
            <TextArea {...field} rows={3} />
            <Description>
              {t("settings.schedules.prompt-description")}
            </Description>
            <FieldError>{fieldState.error?.message}</FieldError>
          </TextField>
        )}
      />
      <div className="grid gap-3 @min-[40rem]/main:grid-cols-3">
        <Controller
          control={form.control}
          name="kind"
          render={({ field }) => (
            <OptionSelect
              label={t("settings.schedules.kind")}
              options={Object.values(ScheduleKind).map((id) => ({
                id,
                label: t(`settings.schedules.kinds.${id}`),
              }))}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
        {kind === ScheduleKind.FixedTime ? null : (
          <Controller
            control={form.control}
            name="everyMinutes"
            render={({ field }) => (
              <OptionSelect
                label={t(
                  kind === ScheduleKind.OnChange
                    ? "settings.schedules.at-most"
                    : "settings.schedules.every"
                )}
                description={
                  kind === ScheduleKind.OnChange
                    ? t("settings.schedules.on-change-description")
                    : undefined
                }
                options={INTERVALS.map((minutes) => ({
                  id: String(minutes),
                  label: everyText(t, minutes),
                }))}
                value={String(field.value)}
                onChange={(id) => field.onChange(Number(id))}
              />
            )}
          />
        )}
        {kind === ScheduleKind.FixedTime ? (
          <>
            <Controller
              control={form.control}
              name="time"
              render={({ field, fieldState }) => (
                <TextField isRequired isInvalid={fieldState.invalid}>
                  <Label>{t("settings.schedules.time")}</Label>
                  <Input {...field} type="time" />
                  <Description>
                    {t("settings.schedules.time-description", {
                      timeZone: clock.timeZone,
                    })}
                  </Description>
                  <FieldError>{fieldState.error?.message}</FieldError>
                </TextField>
              )}
            />
            <Controller
              control={form.control}
              name="days"
              render={({ field }) => (
                <OptionSelect
                  label={t("settings.schedules.on-days")}
                  options={DAY_CHOICES.map((id) => ({
                    id,
                    label: t(`settings.schedules.days.${id}`),
                  }))}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </>
        ) : null}
      </div>
      <Controller
        control={form.control}
        name="approval"
        render={({ field }) => (
          <OptionSelect
            label={t("settings.schedules.approval")}
            description={t(
              `settings.schedules.approval-descriptions.${approval}`
            )}
            options={Object.values(ScheduleApproval).map((id) => ({
              id,
              label: t(`settings.schedules.approvals.${id}`),
            }))}
            value={field.value}
            onChange={field.onChange}
          />
        )}
      />
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" isPending={save.isPending}>
          {t("settings.save")}
        </Button>
        <Button variant="tertiary" isDisabled={pending} onPress={onDone}>
          {t("common.cancel")}
        </Button>
        {task ? (
          <Button
            variant="tertiary"
            className="ml-auto"
            isPending={remove.isPending}
            isDisabled={save.isPending}
            onPress={() => remove.mutate(task.id)}>
            {t("settings.schedules.delete")}
          </Button>
        ) : null}
      </div>
      {error ? (
        <ErrorAlert
          title={t("settings.schedules.change-failed")}
          description={error.message}
        />
      ) : null}
    </Form>
  );
}

/** What a task's last run came to, with a way to the conversation it ran in. */
function LastRun({ task }: { task: ScheduledTaskView }) {
  const { t } = useTranslation();
  const clock = useClock();
  const select = useAgentStore((state) => state.select);
  const agentOpen = useLayoutStore((state) => state.panes[Pane.Agent].open);
  const toggle = useLayoutStore((state) => state.toggle);
  const { lastRun } = task;

  if (!lastRun) return null;

  const { sessionId } = lastRun;

  if (sessionId === null) {
    return (
      <span className="text-warning">
        {t("settings.schedules.last-failed", {
          time: clock.time(lastRun.at),
          reason: lastRun.failure ?? "",
        })}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <span>
        {task.running
          ? t("settings.schedules.running")
          : t("settings.schedules.last-run", { time: clock.time(lastRun.at) })}
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="h-auto px-1 py-0 text-xs font-normal underline"
        onPress={() => {
          if (!agentOpen) toggle(Pane.Agent);

          select(sessionId);
        }}>
        {t("settings.schedules.open-run")}
      </Button>
    </span>
  );
}

/** One task: when it runs, when it next will and what its last run came to, edited below the row. */
function TaskRow({ task }: { task: ScheduledTaskView }) {
  const { t } = useTranslation();
  const clock = useClock();
  const [editing, setEditing] = useState(false);

  const enable = useMutation({
    mutationFn: (enabled: boolean) =>
      window.solyx.schedules.update(task.id, { ...task, enabled }),
  });

  const run = useMutation({
    mutationFn: () => window.solyx.schedules.runNow(task.id),
  });

  const error = enable.error ?? run.error;

  return (
    <SettingsRow
      label={task.name}
      description={
        <span className="flex flex-wrap items-center gap-x-2">
          <span>{scheduleText(t, task.schedule, task.timeZone)}</span>
          {task.enabled && task.schedule.kind === ScheduleKind.OnChange ? (
            <span>· {t("settings.schedules.waits")}</span>
          ) : null}
          {task.nextRunAt === null ? null : (
            <span className="tabular-nums">
              ·{" "}
              {t("settings.schedules.next-run", {
                time: clock.time(task.nextRunAt),
              })}
            </span>
          )}
          <LastRun task={task} />
        </span>
      }
      actions={
        editing ? null : (
          <>
            <Button
              size="sm"
              variant="tertiary"
              isPending={run.isPending}
              isDisabled={task.running}
              onPress={() => run.mutate()}>
              {t("settings.schedules.run-now")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onPress={() => {
                enable.reset();
                run.reset();
                setEditing(true);
              }}>
              {t("settings.edit")}
            </Button>
            <Switch
              isSelected={task.enabled}
              isDisabled={enable.isPending}
              onChange={(enabled) => enable.mutate(enabled)}>
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <span className="sr-only">
                  {t("settings.schedules.enabled", { name: task.name })}
                </span>
              </Switch.Content>
            </Switch>
          </>
        )
      }>
      {editing ? (
        <TaskEditor task={task} onDone={() => setEditing(false)} />
      ) : (
        <p className="line-clamp-2 text-xs whitespace-pre-wrap text-muted">
          {task.prompt}
        </p>
      )}
      {error ? (
        <ErrorAlert
          title={t("settings.schedules.change-failed")}
          description={error.message}
        />
      ) : null}
    </SettingsRow>
  );
}

/**
 * The messages the agent is sent on its own while the app runs: each written, switched on or off,
 * run now and removed here.
 */
export function ScheduleSettings() {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(schedulesQuery());
  const [adding, setAdding] = useState(false);

  if (error) {
    return (
      <RailedColumn className="px-6 py-5">
        <LoadError error={error} onRetry={() => void refetch()} />
      </RailedColumn>
    );
  }

  if (!data) return <LoadingState />;

  return (
    <Section
      title={t("settings.schedules.title")}
      description={t("settings.schedules.description-text")}>
      <div className="flex flex-col gap-3">
        {data.length === 0 ? (
          <p className="text-xs text-muted">{t("settings.schedules.empty")}</p>
        ) : (
          <SettingsList>
            {data.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </SettingsList>
        )}
        {adding ? (
          <TaskEditor onDone={() => setAdding(false)} />
        ) : (
          <Button
            variant="secondary"
            className="self-start"
            onPress={() => setAdding(true)}>
            {t("settings.schedules.add")}
          </Button>
        )}
      </div>
    </Section>
  );
}
