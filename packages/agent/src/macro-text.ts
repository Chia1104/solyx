import type { ExchangeRate } from "@solyx/core/exchange-rate";
import { MacroUnit } from "@solyx/core/macro";
import type { ExpectedFigure, MacroReading } from "@solyx/core/macro";

import { figure, named, percentChange } from "./figures.ts";

/** A figure in its unit, in words. */
export const valueText: Record<MacroUnit, (value: number) => string> = {
  [MacroUnit.Index]: (value) => `index ${figure(value)}`,
  [MacroUnit.UsdMillions]: (value) => `USD ${figure(value)} million`,
  [MacroUnit.Points]: (value) => `${figure(value)} points`,
  [MacroUnit.Percent]: (value) => `${figure(value)}%`,
  [MacroUnit.Rate]: (value) => `${figure(value, 3)}%`,
  [MacroUnit.GrowthOnYear]: (value) => `${figure(value)}% on the year`,
  [MacroUnit.Thousands]: (value) => `${figure(value)} thousand`,
};

/** A figure against the period before, which is what a score, a rate or a count is read by. */
const againstPrevious = ({ unit, value, previous }: MacroReading) =>
  `${valueText[unit](value)}${previous === null ? "" : `, ${valueText[unit](previous)} the period before`}`;

/** What a unit's figures are worth saying of: an index its growth, a sum its size and growth, the rest against the period before. */
const UNIT_TEXT: Record<MacroUnit, (reading: MacroReading) => string> = {
  [MacroUnit.Index]: ({ value, yoy }) =>
    `${percentChange(yoy)} on the year (index ${figure(value)})`,
  [MacroUnit.UsdMillions]: ({ value, yoy }) =>
    `USD ${figure(value)} million, ${percentChange(yoy)} on the year`,
  [MacroUnit.Points]: againstPrevious,
  [MacroUnit.Percent]: againstPrevious,
  [MacroUnit.Rate]: againstPrevious,
  [MacroUnit.GrowthOnYear]: againstPrevious,
  [MacroUnit.Thousands]: againstPrevious,
};

/** A reading in words, as the app worked it out, with what the market expected of it where the source says. */
export const readingText = (reading: MacroReading) =>
  `${named(reading.figure)} ${UNIT_TEXT[reading.unit](reading)}${reading.forecast === null ? "" : `, against ${valueText[reading.unit](reading.forecast)} expected`}`;

/** What the market expects of a figure not out yet, in words. */
export const expectedText = ({
  figure: name,
  unit,
  forecast,
}: ExpectedFigure) => `${named(name)} ${valueText[unit](forecast)}`;

/** The rate a US dollar amount is read in Taiwan dollars at, with the day it closed. */
export const rateText = ({ twdPerUsd, date }: ExchangeRate) =>
  `USD/TWD ${twdPerUsd}, the interbank close of ${date} as Taiwan's central bank published it`;
