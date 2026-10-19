import { sum } from "es-toolkit";
import * as z from "zod";

import { Side } from "../order.ts";

/** Shares in one board lot. */
export const TW_BOARD_LOT = 1000;

/** Shares in whole board lots, the unit Taiwan's market counts trading in. */
export const twLots = (shares: number) => Math.round(shares / TW_BOARD_LOT);

// The exchanges number exchange-traded funds from `00`, real estate trusts' beneficiary securities
// from `01` and exchange-traded notes from `02`, and nothing else from any of them.
const FUND_CODE = /^0[0-2]/;

/** The securities transaction tax a sale pays, as a fraction: funds, notes and real estate trusts pay less than shares. */
export const twSellTaxRate = (code: string) =>
  FUND_CODE.test(code) ? 0.001 : 0.003;

/** The most a Taiwan broker charges on each side, as a fraction of the trade's value. */
export const TW_COMMISSION_RATE = 0.001425;

/** The least a Taiwan broker charges for a trade, in TWD. */
export const TW_MIN_COMMISSION = 20;

/**
 * What a trade of `value` TWD pays at a Taiwan broker's full rate, each rounded down to the dollar
 * as brokers bill it: the commission, at least `TW_MIN_COMMISSION`, and the tax a sale pays.
 */
export function twTradeCosts(value: number, side: Side, code: string) {
  return {
    commission:
      value > 0
        ? Math.max(TW_MIN_COMMISSION, Math.floor(value * TW_COMMISSION_RATE))
        : 0,
    tax: side === Side.Sell ? Math.floor(value * twSellTaxRate(code)) : 0,
  };
}

/** A trade made today, which settles with the account's bank on the second trading day after. */
export interface TwTrade {
  /** The listing's code, which sets a sale's tax. */
  symbol: string;
  side: Side;
  /** Shares. */
  quantity: number;
  price: number;
}

/**
 * What a trade does to the account's bank once it settles, a buy below zero: a buy with the most
 * commission and a sale with the most commission and tax taken off, so it errs low.
 */
export function twSettlement({
  symbol,
  side,
  quantity,
  price,
}: TwTrade): number {
  const value = quantity * price;
  const commission = Math.max(TW_MIN_COMMISSION, value * TW_COMMISSION_RATE);

  return side === Side.Buy
    ? -(value + commission)
    : value - commission - value * twSellTaxRate(symbol);
}

/**
 * What a Taiwan account can spend on buys now: its settlement bank's balance with every trade
 * already made settled against it, since trades settle on the second trading day after. Earlier
 * days' trades come as the broker reckoned them, and today's, its fills and what its buys still on
 * the book could spend, as `twSettlement` reckons them.
 */
export function twSpendable(
  bank: number,
  unsettled: readonly number[],
  today: readonly TwTrade[]
): number {
  return bank + sum(unsettled) + sum(today.map(twSettlement));
}

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
