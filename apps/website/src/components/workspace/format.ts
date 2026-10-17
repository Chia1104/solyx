const prices = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function price(value: number): string {
  return prices.format(value);
}

/** A change as a signed percentage, so -0.0216 reads -2.16%. */
export function percent(change: number): string {
  return `${change > 0 ? "+" : ""}${(change * 100).toFixed(2)}%`;
}
