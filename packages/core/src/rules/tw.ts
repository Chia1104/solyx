import * as z from "zod";

/** Shares in one board lot. */
export const TW_BOARD_LOT = 1000;

// The exchanges number exchange-traded funds from `00`, real estate trusts' beneficiary securities
// from `01` and exchange-traded notes from `02`, and nothing else from any of them.
const FUND_CODE = /^0[0-2]/;

/**
 * Tick size for a TWSE or TPEx listing at `price`, told by its code: exchange-traded funds and
 * notes and real estate trusts step finer than stocks, preferred shares and depositary receipts.
 */
export function twTickSize(price: number, code: string): number {
  if (FUND_CODE.test(code)) return price < 50 ? 0.01 : 0.05;

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

/** The Republic of China calendar counts its years from 1912. */
export const TW_ROC_YEAR_OFFSET = 1911;

/** A day as the exchanges write it in the Republic of China calendar, `1151012` or `115/10/12`, read as `YYYY-MM-DD`. */
export const twRocDaySchema = z
  .string()
  .trim()
  .regex(/^\d{2,3}\/?\d{2}\/?\d{2}$/)
  .transform((day) => {
    const digits = day.replaceAll("/", "");

    return `${Number(digits.slice(0, -4)) + TW_ROC_YEAR_OFFSET}-${digits.slice(-4, -2)}-${digits.slice(-2)}`;
  })
  .pipe(z.iso.date());

/** A date, `YYYY-MM-DD`, as Taiwan's filings write it, in the Republic of China calendar: `民國 115 年 10 月 16 日`. */
export function twRocDate(date: string): string {
  const { year, month, day } =
    Temporal.PlainDate.from(date).withCalendar("roc");

  return `民國 ${year} 年 ${month} 月 ${day} 日`;
}

/** Board lots and odd lots trade in separate books, so one order is either whole board lots or 1–999 shares. */
export function isValidTwQuantity(quantity: number): boolean {
  if (!Number.isInteger(quantity) || quantity <= 0) return false;

  return isTwOddLot(quantity) || quantity % TW_BOARD_LOT === 0;
}

export function isTwOddLot(quantity: number): boolean {
  return quantity < TW_BOARD_LOT;
}
