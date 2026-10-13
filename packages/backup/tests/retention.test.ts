import { expect, test } from "vite-plus/test";

import { DEFAULT_RETENTION, expiredBackups } from "../src/retention.ts";

const MINUTE = 60 * 1000;

const HOUR = 60 * MINUTE;

const DAY = 24 * HOUR;

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
  const kept = keptOf(every(HOUR, 60 * DAY));

  // The last 24 hours whole, which hold the newest four too.
  expect(kept.slice(0, 24)).toEqual(
    Array.from({ length: 24 }, (_, index) => NOW - index * HOUR)
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
  const hourly = keptOf(every(HOUR, 60 * DAY));
  const quarterHourly = keptOf(every(15 * MINUTE, 60 * DAY));

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
    NOW - 15 * MINUTE,
    NOW - 30 * MINUTE,
    NOW - 45 * MINUTE,
  ]);
});

test("a computer left off for months loses nothing to age when it makes a new backup", () => {
  const before = every(DAY, 6 * DAY).map(({ createdAt }) => ({
    createdAt: createdAt - 90 * DAY,
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
  expect(expiredBackups(every(HOUR, 3 * HOUR), TAIPEI)).toEqual([]);
});
