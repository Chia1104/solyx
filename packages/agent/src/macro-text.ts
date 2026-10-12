import { MacroUnit } from "@solyx/core/macro";
import type { MacroReading } from "@solyx/core/macro";

/** A figure's or an indicator's name in words. */
export const named = (name: string) => name.replaceAll("-", " ");

export const figure = (value: number) => String(Number(value.toFixed(2)));

export const growth = (share: number | null) =>
  share === null
    ? "n/a"
    : `${share >= 0 ? "+" : ""}${(share * 100).toFixed(2)}%`;

/** What a unit's figures are worth saying of: an index its growth, a sum its size and growth, a score or a rate itself. */
const UNIT_TEXT: Record<MacroUnit, (reading: MacroReading) => string> = {
  [MacroUnit.Index]: ({ value, yoy }) =>
    `${growth(yoy)} on the year (index ${figure(value)})`,
  [MacroUnit.UsdMillions]: ({ value, yoy }) =>
    `USD ${figure(value)} million, ${growth(yoy)} on the year`,
  [MacroUnit.Points]: ({ value, previous }) =>
    `${figure(value)} points${previous === null ? "" : `, ${figure(previous)} the period before`}`,
  [MacroUnit.Percent]: ({ value, previous }) =>
    `${figure(value)}%${previous === null ? "" : `, ${figure(previous)}% the period before`}`,
};

/** A reading in words, as the app worked it out. */
export const readingText = (reading: MacroReading) =>
  `${named(reading.figure)} ${UNIT_TEXT[reading.unit](reading)}`;
