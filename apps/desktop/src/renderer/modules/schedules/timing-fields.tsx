import {
  Description,
  FieldError,
  Input,
  Label,
  TextField,
} from "@heroui/react";
import type { TFunction } from "i18next";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { Market, marketSchema } from "@solyx/core/market";
import { ScheduleKind } from "@solyx/core/schedule";
import type { Schedule } from "@solyx/core/schedule";

import { useClock } from "../../app/clock.ts";
import { OptionSelect } from "../../components/option-select.tsx";

const HOUR_MINUTES = 60;

const DAY_MINUTES = 24 * HOUR_MINUTES;

const EVERY_DAY = "every-day";

// Every day, or only the days one market trades.
const DAY_CHOICES: (typeof EVERY_DAY | Market)[] = [
  EVERY_DAY,
  ...Object.values(Market),
];

/** A span as words: minutes below an hour, whole days where it is one, hours otherwise. */
export function everyText(t: TFunction, minutes: number): string {
  if (minutes < HOUR_MINUTES) {
    return t("settings.schedules.every-minutes", { count: minutes });
  }

  return minutes % DAY_MINUTES === 0
    ? t("settings.schedules.every-days", { count: minutes / DAY_MINUTES })
    : t("settings.schedules.every-hours", { count: minutes / HOUR_MINUTES });
}

/** When something runs, in a line: its span, its time on its own clock and the days it keeps to, or what it waits on. */
export function scheduleText(
  t: TFunction,
  schedule: Schedule,
  timeZone: string
): string {
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

/** When something runs, as a form holds it; whichever fields its kind does not use keep what they had. */
export const timingFieldSchemas = (t: TFunction) => ({
  kind: z.enum(ScheduleKind),
  everyMinutes: z.number(),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, {
    error: t("settings.schedules.time-required"),
  }),
  days: z.union([z.literal(EVERY_DAY), marketSchema]),
});

export type TimingForm = z.infer<
  z.ZodObject<ReturnType<typeof timingFieldSchemas>>
>;

/** What a new schedule starts from: a morning time, every day. */
export const NEW_TIMING: TimingForm = {
  kind: ScheduleKind.FixedTime,
  everyMinutes: HOUR_MINUTES,
  time: "08:30",
  days: EVERY_DAY,
};

/** The form's fields a schedule fills; the rest keep what a new one starts with. */
export function timingOf(schedule: Schedule): Partial<TimingForm> {
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

/** The schedule a form describes; its span is how often for an interval and how seldom at least for a change. */
export function scheduleOf(form: TimingForm): Schedule {
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
 * The fields that say when something runs, for whichever form provides them: which kind of the
 * `kinds` offered, then its span among `intervals`, in minutes, or its time of day and days.
 */
export function TimingFields({
  kinds,
  intervals,
}: {
  kinds: readonly ScheduleKind[];
  intervals: readonly number[];
}) {
  const { t } = useTranslation();
  const clock = useClock();
  const { control } = useFormContext<TimingForm>();
  const kind = useWatch({ control, name: "kind" });

  return (
    <div className="grid gap-3 @min-[40rem]/main:grid-cols-3">
      <Controller
        control={control}
        name="kind"
        render={({ field }) => (
          <OptionSelect
            label={t("settings.schedules.kind")}
            options={kinds.map((id) => ({
              id,
              label: t(`settings.schedules.kinds.${id}`),
            }))}
            value={field.value}
            onChange={field.onChange}
          />
        )}
      />
      {kind === ScheduleKind.FixedTime ? (
        <>
          <Controller
            control={control}
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
            control={control}
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
      ) : (
        <Controller
          control={control}
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
              options={intervals.map((minutes) => ({
                id: String(minutes),
                label: everyText(t, minutes),
              }))}
              value={String(field.value)}
              onChange={(id) => field.onChange(Number(id))}
            />
          )}
        />
      )}
    </div>
  );
}
