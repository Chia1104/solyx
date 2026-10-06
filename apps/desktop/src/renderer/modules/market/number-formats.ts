import { memoize } from "es-toolkit";

/**
 * Number formats for prices, their changes and volumes, built once per locale since the chart
 * legend formats on every crosshair move.
 */
export const numberFormats = memoize((locale: string) => ({
  /** Up to four decimals, for the 0.0001 tick of US prices under $1. */
  price: new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }),
  percentChange: new Intl.NumberFormat(locale, {
    style: "percent",
    signDisplay: "exceptZero",
    maximumFractionDigits: 2,
  }),
  indicator: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
  /** A share of a whole, such as a likelihood. */
  percent: new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }),
  volume: new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 2,
  }),
  /** A signed sum of money, such as a holding's gain. */
  signedAmount: new Intl.NumberFormat(locale, {
    signDisplay: "exceptZero",
    maximumFractionDigits: 2,
  }),
  /** A quote's figures keep at least two decimals. */
  quotePrice: new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }),
  quoteChange: new Intl.NumberFormat(locale, {
    signDisplay: "exceptZero",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }),
  quotePercentChange: new Intl.NumberFormat(locale, {
    style: "percent",
    signDisplay: "exceptZero",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
}));
