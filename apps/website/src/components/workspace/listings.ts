import type { Candle } from "@solyx/core/candles";
import { twTickSize } from "@solyx/core/rules/tw";

/** A made-up Taiwan listing the demo workspace shows; none of its prices are real. */
export interface Listing {
  code: string;
  name: string;
  last: number;
  /** The last session's change as a fraction, so -0.0216 is down 2.16%. */
  change: number;
  /** Daily volatility of the made-up path, as a fraction. */
  volatility: number;
}

export const LISTINGS: readonly Listing[] = [
  {
    code: "2454",
    name: "聯發科",
    last: 4525,
    change: -0.0216,
    volatility: 0.018,
  },
  {
    code: "2330",
    name: "台積電",
    last: 2490,
    change: -0.0197,
    volatility: 0.014,
  },
  {
    code: "0050",
    name: "元大台灣50",
    last: 112.4,
    change: -0.0209,
    volatility: 0.009,
  },
  {
    code: "2308",
    name: "台達電",
    last: 1775,
    change: 0.0143,
    volatility: 0.017,
  },
  {
    code: "6669",
    name: "緯穎",
    last: 2195,
    change: -0.0352,
    volatility: 0.022,
  },
  {
    code: "2881",
    name: "富邦金",
    last: 160,
    change: 0.0095,
    volatility: 0.01,
  },
];

const SESSIONS = 120;

// The demo's last session; the path is anchored here so every render draws the same bars.
const LAST_SESSION = Date.UTC(2026, 9, 13);

const DAY_MS = 86_400_000;

// Taipei is UTC+8 all year, and a daily bar opens at its midnight.
const TAIPEI_OFFSET_MS = 8 * 3_600_000;

/** Seeded so the server and the browser draw the same bars. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function normal(random: () => number): number {
  const u = 1 - random();
  const v = random();

  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Decimal places a price at this level is quoted in. */
function tickDecimals(price: number, code: string): number {
  return Math.max(0, -Math.floor(Math.log10(twTickSize(price, code))));
}

/** `price` on its tick: the nearest by default, or `Math.ceil` and `Math.floor` to stay inside a bound. */
export function roundToTick(
  price: number,
  code: string,
  round: (value: number) => number = Math.round
): number {
  const tick = twTickSize(price, code);

  return Number(
    (round(price / tick) * tick).toFixed(tickDecimals(price, code))
  );
}

/** The last session's move from the close before it. */
export function sessionChange(candles: readonly Candle[]) {
  const last = candles.at(-1)?.close ?? 0;
  const previous = candles.at(-2)?.close ?? last;

  return { change: last - previous, ratio: (last - previous) / previous };
}

function weekdaysEndingAt(last: number, count: number): number[] {
  const days: number[] = [];

  for (let day = last; days.length < count; day -= DAY_MS) {
    const weekday = new Date(day).getUTCDay();

    if (weekday !== 0 && weekday !== 6) days.unshift(day);
  }

  return days;
}

/**
 * Daily bars that end at the listing's last price and change: a slow swing with noise that
 * reverts toward it, scaled so the last two closes land where the listing says.
 */
export function candlesFor(listing: Listing): Candle[] {
  const random = seededRandom(Number(listing.code) + 7);
  const days = weekdaysEndingAt(LAST_SESSION, SESSIONS);
  const phase = random() * Math.PI * 2;
  let wander = 0;

  const path = days.map((_, i) => {
    wander = wander * 0.94 + listing.volatility * normal(random);

    return Math.exp(
      0.1 * Math.sin((i / SESSIONS) * Math.PI * 1.4 + phase) + wander
    );
  });

  const scale = listing.last / (1 + listing.change) / path[SESSIONS - 2];
  const closes = path.map((close) => close * scale);
  closes[SESSIONS - 1] = listing.last;

  return days.map((day, i) => {
    const close = closes[i];

    const open =
      i === 0 ? close : closes[i - 1] * Math.exp(0.004 * normal(random));

    const reach = listing.volatility * 0.6;

    const high =
      Math.max(open, close) * Math.exp(Math.abs(normal(random)) * reach);

    const low =
      Math.min(open, close) / Math.exp(Math.abs(normal(random)) * reach);

    return {
      time: (day - TAIPEI_OFFSET_MS) / 1000,
      open: roundToTick(open, listing.code),
      high: roundToTick(high, listing.code),
      low: roundToTick(low, listing.code),
      close: roundToTick(close, listing.code),
      volume: Math.round(8_000_000 + 6_000_000 * random()),
    };
  });
}
