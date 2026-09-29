/** Reg NMS: sub-penny quotes are only allowed below $1. */
export function usTickSize(price: number): number {
  return price < 1 ? 0.0001 : 0.01;
}

/** Whole shares only; fractional support differs per broker and is not modelled yet. */
export function isValidUsQuantity(quantity: number): boolean {
  return Number.isInteger(quantity) && quantity > 0;
}
