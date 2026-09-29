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

/** Board lots and odd lots trade in separate books, so one order is either whole board lots or 1–999 shares. */
export function isValidTwQuantity(quantity: number): boolean {
  if (!Number.isInteger(quantity) || quantity <= 0) return false;

  return quantity < TW_BOARD_LOT || quantity % TW_BOARD_LOT === 0;
}

export function isTwOddLot(quantity: number): boolean {
  return quantity < TW_BOARD_LOT;
}
