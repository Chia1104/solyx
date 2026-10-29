/** Reg NMS: sub-penny quotes are only allowed below $1. */
export function usTickSize(price: number): number {
  return price < 1 ? 0.0001 : 0.01;
}

/** Whole shares only; fractional support differs per broker and is not modelled yet. */
export function isValidUsQuantity(quantity: number): boolean {
  return Number.isInteger(quantity) && quantity > 0;
}

/**
 * The SEC's Section 31 fee on a sale, as a fraction of its value: $20.60 a million from
 * 2026-04-04, until the SEC sets it again for its next fiscal year.
 */
export const US_SEC_FEE_RATE = 0.0000206;

/** What the US withholds of a dividend paid to a Taiwan resident, whom no tax treaty covers. */
export const US_DIVIDEND_WITHHOLDING = 0.3;
