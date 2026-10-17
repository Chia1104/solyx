import { expect, test } from "vite-plus/test";

import { DAY_MS, HOUR_MS, MINUTE_MS } from "@solyx/utils/date";

import { DEFAULT_RETENTION, expiredBackups } from "../src/retention.ts";

const TAIPEI = "Asia/Taipei";

// A Tuesday afternoon in Taipei.
const NOW = Date.parse("2026-10-13T15:10:00+08:00");

/** A backup every `step` over the `span` before now, the newest at now. */
const every = (step: number, span: number) =>
  Array.from({ length: Math.floor(span / step) + 1 }, (_, index) => ({
    createdAt: NOW - index * step,
  }));

const keptOf = (backups: { createdAt: number }[], timeZone = TAIPEI) => {
  const expired = new Set(expiredBackups(backups, timeZone));

  return backups
    .filter((backup) => !expired.has(backup))
    .map(({ createdAt }) => createdAt)
    .toSorted((a, b) => b - a);
};

const local = (at: number) =>
  Temporal.Instant.fromEpochMilliseconds(at)
    .toZonedDateTimeISO(TAIPEI)
    .toPlainDateTime()
    .toString();

test("backups thin out with age: every hour of a day, then a day of each week, then a week of each month", () => {
  const kept = keptOf(every(HOUR_MS, 60 * DAY_MS));

  // The last 24 hours whole, which hold the newest four too.
  expect(kept.slice(0, 24)).toEqual(
    Array.from({ length: 24 }, (_, index) => NOW - index * HOUR_MS)
  );

  // Those reach into yesterday, whose last backup is among them. Then the last backup of each
  // earlier day, back to seven days in all, and of each earlier week, back to four in all.
  expect(kept.slice(24).map(local)).toEqual([
    "2026-10-11T23:10:00",
    "2026-10-10T23:10:00",
    "2026-10-09T23:10:00",
    "2026-10-08T23:10:00",
    "2026-10-07T23:10:00",
    "2026-10-04T23:10:00",
    "2026-09-27T23:10:00",
  ]);
});

test("making backups more often keeps no more of them", () => {
  const hourly = keptOf(every(HOUR_MS, 60 * DAY_MS));
  const quarterHourly = keptOf(every(15 * MINUTE_MS, 60 * DAY_MS));

  const most =
    DEFAULT_RETENTION.newest +
    DEFAULT_RETENTION.hours +
    DEFAULT_RETENTION.days +
    DEFAULT_RETENTION.weeks;

  expect(hourly.length).toBeLessThanOrEqual(most);
  expect(quarterHourly.length).toBeLessThanOrEqual(most);
  // Only the newest few are closer together.
  expect(quarterHourly.slice(0, 4)).toEqual([
    NOW,
    NOW - 15 * MINUTE_MS,
    NOW - 30 * MINUTE_MS,
    NOW - 45 * MINUTE_MS,
  ]);
});

test("a computer left off for months loses nothing to age when it makes a new backup", () => {
  const before = every(DAY_MS, 6 * DAY_MS).map(({ createdAt }) => ({
    createdAt: createdAt - 90 * DAY_MS,
  }));

  expect(expiredBackups([{ createdAt: NOW }, ...before], TAIPEI)).toEqual([]);
});

test("a day is the user's own, not the world's", () => {
  // Half past eleven at night and half past midnight in Taipei, one afternoon elsewhere.
  const lateEvening = Date.parse("2026-10-13T23:30:00+08:00");
  const afterMidnight = Date.parse("2026-10-14T00:30:00+08:00");

  const days = { newest: 0, hours: 0, days: 7, weeks: 0 };

  const backups = [{ createdAt: lateEvening }, { createdAt: afterMidnight }];

  expect(expiredBackups(backups, TAIPEI, days)).toEqual([]);
  expect(expiredBackups(backups, "UTC", days)).toEqual([
    { createdAt: lateEvening },
  ]);
});

test("nothing is deleted while there are fewer backups than are kept", () => {
  expect(expiredBackups([], TAIPEI)).toEqual([]);
  expect(expiredBackups(every(HOUR_MS, 3 * HOUR_MS), TAIPEI)).toEqual([]);
});
