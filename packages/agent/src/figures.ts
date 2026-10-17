import { round } from "es-toolkit";

/** What a figure the app does not have reads as. */
const MISSING = "n/a";

/** A number without the digits arithmetic leaves behind, to `digits` places at most. */
export const figure = (value: number | null, digits = 2) =>
  value === null ? MISSING : String(round(value, digits));

/** A figure with a plus where it is above zero, so a change reads by its side. */
export const signedFigure = (value: number, digits = 2) =>
  `${value > 0 ? "+" : ""}${figure(value, digits)}`;

/** `value` to exactly `digits` places, with a plus where it is above zero. */
export const signed = (value: number, digits = 2) =>
  `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;

/** A change given as a fraction, in percent with its sign. */
export const percentChange = (fraction: number | null, digits = 2) =>
  fraction === null ? MISSING : `${signed(fraction * 100, digits)}%`;

/** A part given as a fraction of its whole, in percent. */
export const percent = (fraction: number | null, digits = 1) =>
  fraction === null ? MISSING : `${(fraction * 100).toFixed(digits)}%`;

/** An amount in whole millions. */
export const millions = (amount: number) => Math.round(amount / 1e6);

/** A name the app writes with hyphens, such as a sector's or an indicator's, in words. */
export const named = (name: string) => name.replaceAll("-", " ");

/** A forecast scenario's band of closes in words; `null` leaves that side open. */
export function bandText(low: number | null, high: number | null) {
  if (low === null) return `below ${high}`;

  return high === null ? `${low} and above` : `${low} to ${high}`;
}
