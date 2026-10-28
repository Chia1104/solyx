import { Currency } from "./market.ts";

/** What a US dollar fetched in Taiwan dollars at one day's close. */
export interface ExchangeRate {
  /** `YYYY-MM-DD` on Taiwan's calendar, the day the rate closed. */
  date: string;
  twdPerUsd: number;
}

/** `amount` of `currency` in Taiwan dollars at `rate`. */
export const inTwd = (
  amount: number,
  currency: Currency,
  rate: ExchangeRate
): number => (currency === Currency.USD ? amount * rate.twdPerUsd : amount);

/** Where the rate between the app's two currencies comes from. */
export interface ExchangeRateProvider {
  readonly id: string;
  /** The newest rate its source has closed. */
  latest(): Promise<ExchangeRate>;
}
