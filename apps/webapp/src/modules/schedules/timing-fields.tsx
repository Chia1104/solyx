import { useContext, useEffect } from "react";

import { Description, FieldError, Label, TimeField } from "@heroui/react";
import {
  Calendar03Icon,
  ChartCandlestickIcon,
  Clock01Icon,
  FlashIcon,
  RepeatIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { parseTime } from "@internationalized/date";
import type { TFunction } from "i18next";
import { TimeFieldStateContext } from "react-aria-components";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import {
  ChangeKind,
  EVERY_CHANGE,
  watchesListings,
  watchesThemes,
} from "@solyx/core/changes";
import { Market, marketSchema, symbolRefSchema } from "@solyx/core/market";
import { ScheduleKind } from "@solyx/core/schedule";
import type { Schedule } from "@solyx/core/schedule";
import { HOUR_MINUTES, DAY_MINUTES } from "@solyx/utils/date";

import { useClock } from "../../app/clock.ts";
import { Icon } from "../../components/icon.tsx";
import { OptionSelect } from "../../components/option-select.tsx";

const EVERY_DAY = "every-day";

// A time of day as a schedule keeps it: `HH:MM` on a 24-hour clock.
const TIME_OF_DAY = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const twoDigits = (value: number) => String(value).padStart(2, "0");

// Every day, or only the days one market trades.
const KIND_ICON: Record<ScheduleKind, IconSvgElement> = {
  [ScheduleKind.Interval]: RepeatIcon,
  [ScheduleKind.FixedTime]: Clock01Icon,
  [ScheduleKind.OnChange]: FlashIcon,
};

const DAY_CHOICES: (typeof EVERY_DAY | Market)[] = [
  EVERY_DAY,
  ...Object.values(Market),
];

/** A span as words: minutes below an hour, whole days where it is one, hours otherwise. */
function everyText(t: TFunction, minutes: number): string {
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

/**
 * When something runs, as a form holds it; whichever fields its kind does not use keep what they
 * had. A change's scope names its listings and themes only where it does not take every one.
 */
export const timingFieldSchemas = (t: TFunction) => ({
  kind: z.enum(ScheduleKind),
  everyMinutes: z.number(),
  time: z.string().regex(TIME_OF_DAY, {
    error: t("settings.schedules.time-required"),
  }),
  days: z.union([z.literal(EVERY_DAY), marketSchema]),
  changeKinds: z.array(z.enum(ChangeKind)),
  everyListing: z.boolean(),
  listings: z.array(symbolRefSchema),
  everyTheme: z.boolean(),
  themes: z.array(z.string()),
});

export type TimingForm = z.infer<
  z.ZodObject<ReturnType<typeof timingFieldSchemas>>
>;

/** Refuses a change's scope that names nothing, on the field that should. */
export const checkScope =
  (t: TFunction) => (form: TimingForm, context: z.RefinementCtx) => {
    if (form.kind !== ScheduleKind.OnChange) return;

    const kinds = { kinds: form.changeKinds };

    const missing = (path: keyof TimingForm, message: string) =>
      context.addIssue({ code: "custom", path: [path], message });

    if (form.changeKinds.length === 0) {
      missing("changeKinds", t("settings.schedules.scope.kinds-required"));
    }

    if (
      watchesListings(kinds) &&
      !form.everyListing &&
      form.listings.length === 0
    ) {
      missing("listings", t("settings.schedules.scope.listings-required"));
    }

    if (watchesThemes(kinds) && !form.everyTheme && form.themes.length === 0) {
      missing("themes", t("settings.schedules.scope.themes-required"));
    }
  };

/** What a new schedule starts from: a morning time, every day, and every change once it waits on one. */
export const NEW_TIMING: TimingForm = {
  kind: ScheduleKind.FixedTime,
  everyMinutes: HOUR_MINUTES,
  time: "08:30",
  days: EVERY_DAY,
  changeKinds: [...EVERY_CHANGE.kinds],
  everyListing: true,
  listings: [],
  everyTheme: true,
  themes: [],
};

/** The form's fields a schedule fills; the rest keep what a new one starts with. */
export function timingOf(schedule: Schedule): Partial<TimingForm> {
  switch (schedule.kind) {
    case ScheduleKind.Interval:
      return { kind: schedule.kind, everyMinutes: schedule.everyMinutes };
    case ScheduleKind.OnChange: {
      const { kinds, listings, themes } = schedule.scope;

      return {
        kind: schedule.kind,
        everyMinutes: schedule.atMostEveryMinutes,
        changeKinds: kinds,
        everyListing: listings === null,
        listings: listings ?? [],
        everyTheme: themes === null,
        themes: themes ?? [],
      };
    }

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
    case ScheduleKind.OnChange: {
      const kinds = { kinds: form.changeKinds };

      return {
        kind: form.kind,
        atMostEveryMinutes: form.everyMinutes,
        scope: {
          ...kinds,
          listings:
            watchesListings(kinds) && !form.everyListing ? form.listings : null,
          themes: watchesThemes(kinds) && !form.everyTheme ? form.themes : null,
        },
      };
    }

    case ScheduleKind.FixedTime:
      return {
        kind: form.kind,
        time: form.time,
        tradingDaysOf: form.days === EVERY_DAY ? null : form.days,
      };
  }
}

/**
 * Keeps the form's time as the field around it shows it: `HH:MM` for a whole time, empty for one
 * left unfinished. The field's own change events cannot say this: React Aria keeps a field's last
 * whole value once a segment is cleared, and tells nobody when the same time is typed back.
 */
function ShownTime() {
  const state = useContext(TimeFieldStateContext);
  const { setValue } = useFormContext<TimingForm>();

  const whole =
    state !== null &&
    state.value !== null &&
    state.segments.every(
      ({ isEditable, isPlaceholder }) => !isEditable || !isPlaceholder
    );

  const time = whole
    ? `${twoDigits(state.timeValue.hour)}:${twoDigits(state.timeValue.minute)}`
    : "";

  useEffect(() => {
    setValue("time", time);
  }, [time, setValue]);

  return null;
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
              icon: <Icon icon={KIND_ICON[id]} />,
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
              // The form keeps the time as the schedule does, `HH:MM`, whatever hour cycle the
              // app's language shows it in. The field starts from the form's time and then holds
              // its own, which `ShownTime` hands back, so a time left unfinished keeps the
              // segments still filled while the form refuses it as it is saved.
              <TimeField
                fullWidth
                isRequired
                name={field.name}
                isInvalid={fieldState.invalid}
                defaultValue={
                  TIME_OF_DAY.test(field.value) ? parseTime(field.value) : null
                }
                onBlur={field.onBlur}>
                <ShownTime />
                <Label>{t("settings.schedules.time")}</Label>
                <TimeField.Group fullWidth>
                  <TimeField.Input>
                    {(segment) => <TimeField.Segment segment={segment} />}
                  </TimeField.Input>
                </TimeField.Group>
                <Description>
                  {t("settings.schedules.time-description", {
                    timeZone: clock.timeZone,
                  })}
                </Description>
                <FieldError>{fieldState.error?.message}</FieldError>
              </TimeField>
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
                  // A market's trading days, against every day of the week.
                  icon: (
                    <Icon
                      icon={
                        id === EVERY_DAY ? Calendar03Icon : ChartCandlestickIcon
                      }
                    />
                  ),
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
