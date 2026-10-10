import { ScheduleKind } from "@solyx/core/schedule";
import type { Schedule } from "@solyx/core/schedule";
import { weekdays } from "@solyx/core/session";
import type { TradingDays } from "@solyx/core/session";

import type { Diagnostics } from "../telemetry/diagnostics.ts";

import type { TradingCalendar } from "./trading-calendar.ts";

/** The days a schedule's market trades, for whatever the app times by one. */
export type ScheduleDays = (schedule: Schedule) => Promise<TradingDays>;

/**
 * Reads the trading days of the market a time of day keeps to. A schedule that names no market,
 * or whose market's calendar cannot be read, keeps to weekdays, so a provider out of reach never
 * stops what the clock times.
 */
export function createScheduleDays({
  tradingDays,
  diagnostics,
}: {
  tradingDays: TradingCalendar;
  diagnostics: Pick<Diagnostics, "recovered">;
}): ScheduleDays {
  return async (schedule) => {
    const market =
      schedule.kind === ScheduleKind.FixedTime ? schedule.tradingDaysOf : null;

    if (market === null) return weekdays;

    try {
      return await tradingDays(market);
    } catch (error) {
      diagnostics.recovered(error, "schedules.trading-days", {
        "solyx.market": market,
      });

      return weekdays;
    }
  };
}
