import type { Candle } from "./candles.ts";

/** One value per input bar; `null` while the indicator is still warming up. */
export type IndicatorLine = (number | null)[];

/**
 * The simple moving averages charts draw and the agent reads, shortest first, in the groups
 * Taiwan reads them in: the week, fortnight and month lines, then the quarter, half-year and
 * year lines that say which way the trend runs.
 */
export const MOVING_AVERAGE_PERIODS = {
  short: [5, 10, 20],
  long: [60, 120, 240],
};

export function sma(values: readonly number[], period: number): IndicatorLine {
  const line: IndicatorLine = [];
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    sum += values[i];

    if (i >= period) sum -= values[i - period];

    line.push(i >= period - 1 ? sum / period : null);
  }

  return line;
}

/**
 * Each bar's volume over the average of the `period` bars ending with it, so 1.5 reads as half
 * again a usual session's; `null` where those bars traded nothing.
 */
export function volumeRatio(
  volumes: readonly number[],
  period = 20
): IndicatorLine {
  const average = sma(volumes, period);

  return volumes.map((volume, i) => {
    const mean = average[i];

    return mean === null || mean === 0 ? null : volume / mean;
  });
}

/** Seeded with the SMA of its first `period` values; leading nulls from an upstream line are skipped. */
export function ema(
  values: readonly (number | null)[],
  period: number
): IndicatorLine {
  const line: IndicatorLine = [];
  const smoothing = 2 / (period + 1);
  let previous: number | null = null;
  let seedSum = 0;
  let seedCount = 0;

  for (const value of values) {
    if (value === null) {
      line.push(null);
    } else if (previous === null) {
      seedSum += value;
      seedCount += 1;

      if (seedCount === period) previous = seedSum / period;

      line.push(previous);
    } else {
      previous = value * smoothing + previous * (1 - smoothing);
      line.push(previous);
    }
  }

  return line;
}

export interface BollingerBands {
  middle: IndicatorLine;
  upper: IndicatorLine;
  lower: IndicatorLine;
}

/** Bands sit `width` population standard deviations around the SMA. */
export function bollinger(
  values: readonly number[],
  period = 20,
  width = 2
): BollingerBands {
  const middle = sma(values, period);
  const upper: IndicatorLine = [];
  const lower: IndicatorLine = [];

  for (let i = 0; i < values.length; i++) {
    const mean = middle[i];

    if (mean === null) {
      upper.push(null);
      lower.push(null);
    } else {
      let squares = 0;

      for (let j = i - period + 1; j <= i; j++)
        squares += (values[j] - mean) ** 2;

      const deviation = Math.sqrt(squares / period) * width;

      upper.push(mean + deviation);
      lower.push(mean - deviation);
    }
  }

  return { middle, upper, lower };
}

function relativeStrength(averageGain: number, averageLoss: number): number {
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;

  return 100 - 100 / (1 + averageGain / averageLoss);
}

/** Wilder's RSI: simple averages for the first `period` changes, then Wilder smoothing. */
export function rsi(values: readonly number[], period = 14): IndicatorLine {
  const line: IndicatorLine = values.length > 0 ? [null] : [];
  let averageGain = 0;
  let averageLoss = 0;

  for (let i = 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    if (i <= period) {
      averageGain += gain / period;
      averageLoss += loss / period;
      line.push(
        i === period ? relativeStrength(averageGain, averageLoss) : null
      );
    } else {
      averageGain = (averageGain * (period - 1) + gain) / period;
      averageLoss = (averageLoss * (period - 1) + loss) / period;
      line.push(relativeStrength(averageGain, averageLoss));
    }
  }

  return line;
}

export interface Macd {
  macd: IndicatorLine;
  signal: IndicatorLine;
  histogram: IndicatorLine;
}

function difference(left: IndicatorLine, right: IndicatorLine): IndicatorLine {
  return left.map((value, i) => {
    const other = right[i];

    return value === null || other === null ? null : value - other;
  });
}

/** Taiwan platforms call the three lines DIF (`macd`), MACD (`signal`) and OSC (`histogram`). */
export function macd(
  values: readonly number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): Macd {
  const macdLine = difference(ema(values, fast), ema(values, slow));
  const signal = ema(macdLine, signalPeriod);

  return { macd: macdLine, signal, histogram: difference(macdLine, signal) };
}

export interface Stochastic {
  k: IndicatorLine;
  d: IndicatorLine;
}

/**
 * Taiwan-style KD: RSV over `period` bars, then K and D smoothed by one third and seeded at 50,
 * unlike the SMA-smoothed stochastic oscillator most Western libraries ship.
 */
export function kd(candles: readonly Candle[], period = 9): Stochastic {
  const k: IndicatorLine = [];
  const d: IndicatorLine = [];
  let previousK = 50;
  let previousD = 50;

  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      k.push(null);
      d.push(null);
    } else {
      let high = -Infinity;
      let low = Infinity;

      for (let j = i - period + 1; j <= i; j++) {
        high = Math.max(high, candles[j].high);
        low = Math.min(low, candles[j].low);
      }

      // A flat window has no range, so the close counts as mid-range.
      const rsv =
        high === low ? 50 : ((candles[i].close - low) / (high - low)) * 100;

      previousK = (2 / 3) * previousK + (1 / 3) * rsv;
      previousD = (2 / 3) * previousD + (1 / 3) * previousK;
      k.push(previousK);
      d.push(previousD);
    }
  }

  return { k, d };
}
