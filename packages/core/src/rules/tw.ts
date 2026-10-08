import { InstrumentKind } from "../market.ts";

/** Shares in one board lot. */
export const TW_BOARD_LOT = 1000;

/** Tick size for TWSE / TPEx stocks and ETFs. */
export function twTickSize(price: number, kind: InstrumentKind): number {
  if (kind === InstrumentKind.ETF) return price < 50 ? 0.01 : 0.05;

  if (price < 10) return 0.01;

  if (price < 50) return 0.05;

  if (price < 100) return 0.1;

  if (price < 500) return 0.5;

  if (price < 1000) return 1;

  return 5;
}

// The day by which a listed company files each quarter's statements, first quarter first; the
// fourth's is the annual report's, in the next year.
const FILING_DEADLINES = [
  { month: 5, day: 15 },
  { month: 8, day: 14 },
  { month: 11, day: 14 },
  { month: 3, day: 31 },
];

/**
 * The date, `YYYY-MM-DD`, by which a quarter ending on `periodEnd` is filed. Companies often file
 * earlier, and financial holdings may file the second quarter later, so it marks when the figures
 * were surely public rather than when they came out.
 */
export function twFilingDeadline(periodEnd: string): string {
  const end = Temporal.PlainDate.from(periodEnd);
  const quarter = Math.ceil(end.month / 3);
  const deadline = FILING_DEADLINES[quarter - 1];

  return end
    .with({
      year: quarter === 4 ? end.year + 1 : end.year,
      month: deadline.month,
      day: deadline.day,
    })
    .toString();
}

/** The date, `YYYY-MM-DD`, by which a month's (`YYYY-MM`) revenue is reported: the tenth of the next. */
export function twRevenueDeadline(month: string): string {
  return Temporal.PlainYearMonth.from(month)
    .add({ months: 1 })
    .toPlainDate({ day: 10 })
    .toString();
}

/** Board lots and odd lots trade in separate books, so one order is either whole board lots or 1–999 shares. */
export function isValidTwQuantity(quantity: number): boolean {
  if (!Number.isInteger(quantity) || quantity <= 0) return false;

  return isTwOddLot(quantity) || quantity % TW_BOARD_LOT === 0;
}

export function isTwOddLot(quantity: number): boolean {
  return quantity < TW_BOARD_LOT;
}
