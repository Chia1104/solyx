import { expect, test } from "vite-plus/test";

import { Market } from "../src/market.ts";
import {
  FIXED_TIME_GRACE_MS,
  ScheduleApproval,
  ScheduleKind,
  isDue,
  nextRun,
  scheduledTaskDraftSchema,
} from "../src/schedule.ts";
import type { Schedule, Timed } from "../src/schedule.ts";
import { weekdays } from "../src/session.ts";

const HOUR_MS = 60 * 60 * 1000;

const taipei = (time: string) => Date.parse(`${time}+08:00`);

// 2026-10-08 is a Thursday.
const SAVED = taipei("2026-10-08T07:00:00");

const everyDay: Schedule = {
  kind: ScheduleKind.FixedTime,
  time: "08:30",
  tradingDaysOf: null,
};

const onTradingDays: Schedule = { ...everyDay, tradingDaysOf: Market.TW };

function task(schedule: Schedule, patch: Partial<Timed> = {}): Timed {
  return {
    schedule,
    timeZone: "Asia/Taipei",
    updatedAt: SAVED,
    lastRun: null,
    ...patch,
  };
}

const ran = (at: number) => ({ at, sessionId: "1", failure: null });

// Every weekday trades, and nothing the app watches has changed.
const QUIET = { trades: weekdays, changed: false };

test("an interval is due once its span has passed since the task was saved or last ran", () => {
  const hourly = task({ kind: ScheduleKind.Interval, everyMinutes: 60 });

  expect(isDue(hourly, SAVED + HOUR_MS - 1, QUIET)).toBe(false);
  expect(isDue(hourly, SAVED + HOUR_MS, QUIET)).toBe(true);
  expect(nextRun(hourly, SAVED, QUIET)).toBe(SAVED + HOUR_MS);

  const again = { ...hourly, lastRun: ran(SAVED + HOUR_MS) };

  expect(isDue(again, SAVED + 1.5 * HOUR_MS, QUIET)).toBe(false);
  expect(nextRun(again, SAVED + 1.5 * HOUR_MS, QUIET)).toBe(
    SAVED + 2 * HOUR_MS
  );
});

test("a time of day is due from its moment on the task's clock, once a day", () => {
  const daily = task(everyDay);

  expect(isDue(daily, taipei("2026-10-08T08:29:00"), QUIET)).toBe(false);
  expect(nextRun(daily, taipei("2026-10-08T08:29:00"), QUIET)).toBe(
    taipei("2026-10-08T08:30:00")
  );
  expect(isDue(daily, taipei("2026-10-08T08:30:00"), QUIET)).toBe(true);

  const done = { ...daily, lastRun: ran(taipei("2026-10-08T08:31:00")) };

  expect(isDue(done, taipei("2026-10-08T15:00:00"), QUIET)).toBe(false);
  expect(nextRun(done, taipei("2026-10-08T15:00:00"), QUIET)).toBe(
    taipei("2026-10-09T08:30:00")
  );
});

test("a time the app slept through is made up for within the grace, and dropped after it", () => {
  const daily = task(everyDay);
  const moment = taipei("2026-10-08T08:30:00");

  expect(isDue(daily, moment + FIXED_TIME_GRACE_MS, QUIET)).toBe(true);
  expect(isDue(daily, moment + FIXED_TIME_GRACE_MS + 1, QUIET)).toBe(false);

  // Days later only the newest time counts, so one run makes up for them all.
  expect(isDue(daily, taipei("2026-10-12T09:00:00"), QUIET)).toBe(true);
  expect(
    isDue(
      { ...daily, lastRun: ran(taipei("2026-10-12T09:00:00")) },
      taipei("2026-10-12T09:01:00"),
      QUIET
    )
  ).toBe(false);
});

test("a task saved after today's time waits for tomorrow's", () => {
  const late = task(everyDay, { updatedAt: taipei("2026-10-08T09:00:00") });

  expect(isDue(late, taipei("2026-10-08T09:01:00"), QUIET)).toBe(false);
  expect(isDue(late, taipei("2026-10-09T08:30:00"), QUIET)).toBe(true);
});

test("a time kept to a market's trading days skips the days it is closed", () => {
  const saturday = taipei("2026-10-10T08:30:00");

  const briefing = task(onTradingDays, {
    lastRun: ran(saturday - 23 * HOUR_MS),
  });

  expect(isDue(briefing, saturday + HOUR_MS, QUIET)).toBe(false);
  expect(nextRun(briefing, saturday + HOUR_MS, QUIET)).toBe(
    taipei("2026-10-12T08:30:00")
  );

  // The exchange's own calendar decides, not the weekday.
  const closedMonday = (date: string) =>
    weekdays(date) && date !== "2026-10-12";

  expect(
    nextRun(briefing, saturday + HOUR_MS, {
      trades: closedMonday,
      changed: false,
    })
  ).toBe(taipei("2026-10-13T08:30:00"));
  expect(
    isDue(task(everyDay), saturday + HOUR_MS, {
      trades: closedMonday,
      changed: false,
    })
  ).toBe(true);
});

test("a trading day is read on the exchange's calendar, whatever clock the task keeps", () => {
  // 20:30 on Sunday in New York is Monday morning in Taipei.
  const evening = task(
    { ...onTradingDays, time: "20:30" },
    {
      timeZone: "America/New_York",
      updatedAt: Date.parse("2026-10-11T12:00:00-04:00"),
    }
  );

  expect(isDue(evening, Date.parse("2026-10-11T20:30:00-04:00"), QUIET)).toBe(
    true
  );
  // Friday evening there is Saturday in Taipei.
  expect(
    isDue(
      { ...evening, updatedAt: Date.parse("2026-10-09T12:00:00-04:00") },
      Date.parse("2026-10-09T20:30:00-04:00"),
      QUIET
    )
  ).toBe(false);
});

test("a draft refuses what cannot run: a span too short, a time that is none, a zone unknown, a key", () => {
  const draft = {
    name: "Morning brief",
    prompt: "/watchlist-upkeep",
    schedule: everyDay,
    timeZone: "Asia/Taipei",
    locale: "zh-TW",
    approval: ScheduleApproval.Ask,
    enabled: true,
  };

  const refused = [
    { ...draft, schedule: { kind: ScheduleKind.Interval, everyMinutes: 5 } },
    { ...draft, schedule: { ...everyDay, time: "24:00" } },
    { ...draft, timeZone: "Mars/Olympus" },
    { ...draft, approval: "bypass" },
    { ...draft, prompt: "Read it with sk-abcdefghijklmnopqrstuvwxyz first." },
  ];

  expect(scheduledTaskDraftSchema.safeParse(draft).success).toBe(true);
  expect(
    refused.map((each) => scheduledTaskDraftSchema.safeParse(each).success)
  ).toEqual([false, false, false, false, false]);
});

test("a task that waits on a change runs only once something changed, and no sooner than its shortest span", () => {
  const upkeep = task({
    kind: ScheduleKind.OnChange,
    atMostEveryMinutes: 60,
  });

  const changed = { trades: weekdays, changed: true };

  expect(isDue(upkeep, SAVED + 2 * HOUR_MS, QUIET)).toBe(false);
  expect(nextRun(upkeep, SAVED + 2 * HOUR_MS, QUIET)).toBe(null);
  expect(isDue(upkeep, SAVED + HOUR_MS - 1, changed)).toBe(false);
  expect(isDue(upkeep, SAVED + HOUR_MS, changed)).toBe(true);
  expect(nextRun(upkeep, SAVED + HOUR_MS, changed)).toBe(SAVED + HOUR_MS);
});
