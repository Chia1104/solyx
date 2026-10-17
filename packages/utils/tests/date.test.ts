import { expect, test } from "vite-plus/test";

import { shiftDate, shiftMonth, wallTime } from "../src/date.ts";

test.each([
  { date: "2024-02-28", days: 1, shifted: "2024-02-29" },
  { date: "2024-03-01", days: -1, shifted: "2024-02-29" },
  { date: "2026-12-31", days: 1, shifted: "2027-01-01" },
])("$date moved by $days days is $shifted", ({ date, days, shifted }) => {
  expect(shiftDate(date, days)).toBe(shifted);
});

test.each([
  { month: "2026-11", months: 2, shifted: "2027-01" },
  { month: "2026-01", months: -1, shifted: "2025-12" },
])(
  "$month moved by $months months is $shifted",
  ({ month, months, shifted }) => {
    expect(shiftMonth(month, months)).toBe(shifted);
  }
);

test.each([
  {
    timeZone: "Asia/Taipei",
    at: "2026-09-28T16:30:00Z",
    time: "2026-09-29 00:30",
  },
  {
    timeZone: "Europe/London",
    at: "2026-07-01T12:00:00Z",
    time: "2026-07-01 13:00",
  },
  { timeZone: "UTC", at: "2026-07-01T12:00:00Z", time: "2026-07-01 12:00" },
])("$at reads $time on the $timeZone clock", ({ timeZone, at, time }) => {
  expect(wallTime(timeZone, new Date(at))).toBe(time);
});
