import type { ExchangeRate } from "@solyx/core/exchange-rate";
import { MacroUnit } from "@solyx/core/macro";
import type { MacroReading } from "@solyx/core/macro";

import { figure, named, percentChange } from "./figures.ts";

/** What a unit's figures are worth saying of: an index its growth, a sum its size and growth, a score or a rate itself. */
const UNIT_TEXT: Record<MacroUnit, (reading: MacroReading) => string> = {
  [MacroUnit.Index]: ({ value, yoy }) =>
    `${percentChange(yoy)} on the year (index ${figure(value)})`,
  [MacroUnit.UsdMillions]: ({ value, yoy }) =>
    `USD ${figure(value)} million, ${percentChange(yoy)} on the year`,
  [MacroUnit.Points]: ({ value, previous }) =>
    `${figure(value)} points${previous === null ? "" : `, ${figure(previous)} the period before`}`,
  [MacroUnit.Percent]: ({ value, previous }) =>
    `${figure(value)}%${previous === null ? "" : `, ${figure(previous)}% the period before`}`,
};

/** A reading in words, as the app worked it out. */
export const readingText = (reading: MacroReading) =>
  `${named(reading.figure)} ${UNIT_TEXT[reading.unit](reading)}`;

/** The rate a US dollar amount is read in Taiwan dollars at, with the day it closed. */
export const rateText = ({ twdPerUsd, date }: ExchangeRate) =>
  `USD/TWD ${twdPerUsd}, the interbank close of ${date} as Taiwan's central bank published it`;
