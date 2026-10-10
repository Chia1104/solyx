import * as z from "zod";

import { isTimeZone } from "@solyx/utils/is";

import { exchangeDate, marketSchema } from "./market.ts";
import { holdsSecret } from "./memory.ts";
import type { TradingDays } from "./session.ts";

/** How a scheduled task recurs. */
export const ScheduleKind = {
  /** Again once a span has passed since its last run. */
  Interval: "interval",
  /** At one time of day on the task's own clock. */
  FixedTime: "fixed-time",
  /** Once something the app watches has changed since its last run. */
  OnChange: "on-change",
} as const;

export type ScheduleKind = (typeof ScheduleKind)[keyof typeof ScheduleKind];

/** No shorter, so a task cannot spend the user's model budget by the minute. */
export const MIN_INTERVAL_MINUTES = 30;

const MAX_INTERVAL_MINUTES = 7 * 24 * 60;

export const scheduleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal(ScheduleKind.Interval),
    everyMinutes: z
      .number()
      .int()
      .min(MIN_INTERVAL_MINUTES)
      .max(MAX_INTERVAL_MINUTES),
  }),
  z.object({
    kind: z.literal(ScheduleKind.FixedTime),
    /** `HH:MM` on the task's own clock. */
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    /** Runs only where its moment falls on a day this market trades, on the exchange's calendar; `null` runs every day. */
    tradingDaysOf: marketSchema.nullable(),
  }),
  z.object({
    kind: z.literal(ScheduleKind.OnChange),
    /** The shortest span between two runs, however much changes. */
    atMostEveryMinutes: z
      .number()
      .int()
      .min(MIN_INTERVAL_MINUTES)
      .max(MAX_INTERVAL_MINUTES),
  }),
]);

export type Schedule = z.infer<typeof scheduleSchema>;

/**
 * How a run nobody watches gets past a call that must ask. It names no way to let every call run:
 * that stays a choice the user makes in a conversation they are reading.
 */
export const ScheduleApproval = {
  /** Each such call waits for the user, so the run rests there until they answer. */
  Ask: "ask",
  /** One its tool's own check finds harmless runs unasked; the rest wait. */
  Auto: "auto",
} as const;

export type ScheduleApproval =
  (typeof ScheduleApproval)[keyof typeof ScheduleApproval];

export const SCHEDULE_NAME_LENGTH = 80;

export const SCHEDULE_PROMPT_LENGTH = 4_000;

/** A scheduled task as the user writes it. */
export const scheduledTaskDraftSchema = z.object({
  name: z.string().trim().min(1).max(SCHEDULE_NAME_LENGTH),
  /** What the agent is sent each time, as the user would write it; a leading `/name` asks for a skill. */
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(SCHEDULE_PROMPT_LENGTH)
    .refine(
      (text) => !holdsSecret(text),
      "A scheduled task never holds a key, token, password or ID number"
    ),
  schedule: scheduleSchema,
  /** The user's own time zone as an IANA name: a fixed time reads on it, and so does the clock a run is told. */
  timeZone: z
    .string()
    .refine(isTimeZone, "Not a time zone this computer knows"),
  /** The language a run answers in, as a BCP 47 tag. */
  locale: z.string().min(1),
  approval: z.enum(ScheduleApproval),
  enabled: z.boolean(),
});

export type ScheduledTaskDraft = z.infer<typeof scheduledTaskDraftSchema>;

/** What became of a task's run. */
export interface ScheduledRun {
  /** Epoch ms it was started at. */
  at: number;
  /** The conversation it runs in; `null` when it could not start. */
  sessionId: string | null;
  /** Why it could not start; `null` when it did. */
  failure: string | null;
}

/** A message the agent is sent on its own while the app runs, each time in a conversation of its own. */
export interface ScheduledTask extends ScheduledTaskDraft {
  id: string;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms it was last saved, which its next run counts from when that is later than its last run. */
  updatedAt: number;
  lastRun: ScheduledRun | null;
}

/** Where scheduled tasks persist. */
export interface ScheduleStore {
  /** Oldest first. */
  list(): ScheduledTask[];
  get(id: string): ScheduledTask | undefined;
  /** Keeps a new task, or replaces the one of its id. */
  save(task: ScheduledTask): void;
  remove(id: string): void;
}

const MINUTE_MS = 60 * 1000;

/**
 * How late a fixed time still runs. A desktop app is often closed at the time, so the run is made
 * up for as it opens, but one half a day late says little about that morning.
 */
export const FIXED_TIME_GRACE_MS = 12 * 60 * MINUTE_MS;

// Far enough to step over an exchange's longest closure.
const SEARCHED_DAYS = 31;

type FixedTime = Extract<Schedule, { kind: typeof ScheduleKind.FixedTime }>;

/** What decides when a task runs. */
export type Timed = Pick<
  ScheduledTask,
  "schedule" | "timeZone" | "updatedAt" | "lastRun"
>;

/**
 * The first of the schedule's moments that `wanted` takes, looking day by day from the day `at`
 * falls on, forward or back; `null` when none of the days searched has one.
 */
function fixedTime(
  { time, tradingDaysOf }: FixedTime,
  timeZone: string,
  at: number,
  direction: 1 | -1,
  trades: TradingDays,
  wanted: (moment: number) => boolean
): number | null {
  const plainTime = Temporal.PlainTime.from(time);

  const from = Temporal.Instant.fromEpochMilliseconds(at)
    .toZonedDateTimeISO(timeZone)
    .toPlainDate();

  for (let days = 0; days <= SEARCHED_DAYS; days++) {
    const moment = from
      .add({ days: days * direction })
      .toZonedDateTime({ timeZone, plainTime }).epochMilliseconds;

    if (
      wanted(moment) &&
      (tradingDaysOf === null ||
        trades(exchangeDate(tradingDaysOf, new Date(moment))))
    ) {
      return moment;
    }
  }

  return null;
}

/** The moment a task's next run counts from: when it last ran, or was saved if that is later. */
export const countedFrom = ({
  updatedAt,
  lastRun,
}: Pick<Timed, "updatedAt" | "lastRun">) =>
  Math.max(updatedAt, lastRun?.at ?? 0);

/** What a task's time depends on beyond the clock. */
export interface Occasion {
  /** The days the schedule's market trades; read only by a time of day that names one. */
  trades: TradingDays;
  /** Whether what the app watches has changed since `countedFrom`; read only by a task that waits on it. */
  changed: boolean;
}

/**
 * Whether the task owes a run at `now`: its span has passed, its time of day has come since it
 * last ran or was saved and is not yet `FIXED_TIME_GRACE_MS` old, or something changed and its
 * shortest span has passed. Earlier times the app slept through are dropped rather than made up
 * one by one.
 */
export function isDue(
  task: Timed,
  now: number,
  { trades, changed }: Occasion
): boolean {
  const { schedule, timeZone } = task;
  const from = countedFrom(task);

  switch (schedule.kind) {
    case ScheduleKind.Interval:
      return now - from >= schedule.everyMinutes * MINUTE_MS;
    case ScheduleKind.OnChange:
      return changed && now - from >= schedule.atMostEveryMinutes * MINUTE_MS;
    case ScheduleKind.FixedTime: {
      const latest = fixedTime(
        schedule,
        timeZone,
        now,
        -1,
        trades,
        (moment) => moment <= now
      );

      return (
        latest !== null && latest > from && now - latest <= FIXED_TIME_GRACE_MS
      );
    }
  }
}

/**
 * When the task next runs while the app stays open, in epoch ms: `now` for one already due, and
 * `null` for a time of day with no day to fall on within the days searched, or for a task that
 * waits on a change, which no clock tells.
 */
export function nextRun(
  task: Timed,
  now: number,
  occasion: Occasion
): number | null {
  if (isDue(task, now, occasion)) return now;

  const { schedule, timeZone } = task;

  switch (schedule.kind) {
    case ScheduleKind.Interval:
      return countedFrom(task) + schedule.everyMinutes * MINUTE_MS;
    case ScheduleKind.OnChange:
      return null;
    case ScheduleKind.FixedTime:
      return fixedTime(
        schedule,
        timeZone,
        now,
        1,
        occasion.trades,
        (moment) => moment > now
      );
  }
}
