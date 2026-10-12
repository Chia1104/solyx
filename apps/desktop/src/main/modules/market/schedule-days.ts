import { ScheduleKind } from "@solyx/core/schedule";
import type { Schedule } from "@solyx/core/schedule";
import { weekdays } from "@solyx/core/session";
import type { TradingDays } from "@solyx/core/session";

import type { MarketDays } from "./trading-calendar.ts";

/** The days a schedule's market trades, for whatever the app times by one. */
export type ScheduleDays = (schedule: Schedule) => Promise<TradingDays>;

/** Reads the trading days of the market a time of day keeps to; a schedule that names no market keeps to weekdays. */
export function createScheduleDays(marketDays: MarketDays): ScheduleDays {
  return async (schedule) => {
    const market =
      schedule.kind === ScheduleKind.FixedTime ? schedule.tradingDaysOf : null;

    return market === null ? weekdays : marketDays(market);
  };
}
