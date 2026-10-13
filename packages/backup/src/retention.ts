/** How many backups each rule keeps; one backup may be kept by several. */
export interface RetentionPolicy {
  /** The newest ones, whenever they were made. */
  newest: number;
  /** The last backup of each of the newest hours that hold one. */
  hours: number;
  /** The last backup of each of the newest days that hold one. */
  days: number;
  /** The last backup of each of the newest weeks that hold one. */
  weeks: number;
}

/**
 * About a month of history that thins out with age, in forty backups at most however often one
 * is made: making them more often only brings the newest closer to now.
 */
export const DEFAULT_RETENTION: RetentionPolicy = {
  newest: 4,
  hours: 24,
  days: 7,
  weeks: 4,
};

const HOUR_MS = 60 * 60 * 1000;

/**
 * The backups to delete, so that those kept thin out with age: the newest few, then the last of
 * each hour, day and week, days and weeks as `timeZone` has them. A period counts only when it
 * holds a backup, so a computer left off for months keeps as many as one that ran, rather than
 * losing every backup to its age the day it makes a new one.
 */
export function expiredBackups<Backup extends { createdAt: number }>(
  backups: readonly Backup[],
  timeZone: string,
  policy: RetentionPolicy = DEFAULT_RETENTION
): Backup[] {
  const zoned = (at: number) =>
    Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(timeZone);

  const rules: [limit: number, period: (at: number) => string][] = [
    [policy.hours, (at) => String(Math.floor(at / HOUR_MS))],
    [policy.days, (at) => zoned(at).toPlainDate().toString()],
    [policy.weeks, (at) => `${zoned(at).yearOfWeek}-W${zoned(at).weekOfYear}`],
  ];

  const newestFirst = backups.toSorted((a, b) => b.createdAt - a.createdAt);
  const kept = new Set(newestFirst.slice(0, policy.newest));

  for (const [limit, period] of rules) {
    const periods = new Set<string>();

    for (const backup of newestFirst) {
      const name = period(backup.createdAt);

      // Newest first, so the first backup met in a period is its last.
      if (periods.has(name)) continue;

      if (periods.size === limit) break;

      periods.add(name);
      kept.add(backup);
    }
  }

  return newestFirst.filter((backup) => !kept.has(backup));
}
