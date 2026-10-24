import { expect, test, vi } from "vite-plus/test";

import { candleDate } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import {
  PLAYBACK_SESSIONS,
  ROTATION_PERIODS,
  ROTATION_TRAIL,
  RotationAgainst,
  RotationInterval,
  readingThrough,
} from "@solyx/core/rotation";
import { SectorGroup, TW_SECTOR_INDICES, TwSector } from "@solyx/core/sectors";
import { MINUTE_MS, shiftDate } from "@solyx/utils/date";

import { createRotations } from "../src/modules/market/rotations.ts";

const NOW = new Date("2026-09-29T10:00:00+08:00");

const TSMC = { market: Market.TW, symbol: "2330" };

const taipei = (date: string) => Date.parse(`${date}T00:00:00+08:00`) / 1000;

const bar = (date: string, close: number): Candle => ({
  time: taipei(date),
  open: close,
  high: close,
  low: close,
  close,
  volume: 0,
});

/** Flat index bars over the last sessions of September. */
const TAIEX = [
  bar("2026-09-24", 23_000),
  bar("2026-09-25", 23_000),
  bar("2026-09-28", 23_000),
  bar("2026-09-29", 23_000),
];

/** `count` weekday sessions ending 2026-09-29, flat. */
function weekdays(count: number) {
  const day = new Date("2026-09-29T00:00:00Z");
  const dates: string[] = [];

  while (dates.length < count) {
    if (day.getUTCDay() % 6 !== 0) dates.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() - 1);
  }

  return dates.toReversed().map((date) => bar(date, 100));
}

/** A year of weekday sessions, all of them within the newest range the module reads. */
const YEAR = weekdays(250);

/** Every weekday since the first day the module reads, three years back. */
const SPAN = weekdays(800).filter(
  ({ time }) => candleDate(Market.TW, time) >= "2023-10-15"
);

/** A close that rises and falls over `bars`, so every period reads somewhere off the origin. */
const wave = (bars: Candle[]) =>
  bars.map((each, i) => ({
    ...each,
    close: 100 + 10 * Math.sin(i / 9) + i / 20,
  }));

/** Every reading of a listing with too few bars, in the order the module gives them. */
const EMPTY_READINGS = Object.values(RotationInterval).flatMap((interval) =>
  ROTATION_PERIODS[interval].map((period) => ({
    interval,
    period,
    trail: [],
    quadrant: null,
    transition: null,
  }))
);

/** Every answer a history stream gives, in order. */
async function answersOf<Answer>(stream: AsyncIterable<Answer>) {
  const answers: Answer[] = [];

  for await (const answer of stream) answers.push(answer);

  return answers;
}

/** Days before `NOW` the newest range starts and the whole span starts. */
const RECENT_FROM = "2025-10-04";

const SPAN_FROM = "2023-10-15";

function setup(
  bars: Record<string, Candle[]> = { IX0001: TAIEX },
  /** What a read of the years before the newest one waits on, as a source sending them would make it. */
  older?: () => Promise<void>
) {
  const candlesBetween = vi.fn(
    async (
      { symbol }: SymbolRef,
      from: string,
      to: string
    ): Promise<Candle[]> => {
      if (from < RECENT_FROM) await older?.();

      return (bars[symbol] ?? []).filter(({ time }) => {
        const date = candleDate(Market.TW, time);

        return date >= from && date <= to;
      });
    }
  );

  const clock = { now: NOW };

  const rotations = createRotations({
    candlesBetween,
    sourceId: async (market) => (market === Market.TW ? "fake" : null),
    company: async ({ symbol }) =>
      symbol === "2330"
        ? { industry: { code: "24", name: "半導體業" }, shares: 1 }
        : null,
    now: () => clock.now,
  });

  return { rotations, candlesBetween, clock };
}

test("sectors read the TAIEX's and each index's daily bars once, the newest year and then the two before it, and keep them a minute", async () => {
  const { rotations, candlesBetween, clock } = setup();

  const set = await rotations.sectors();

  expect(candlesBetween).toHaveBeenCalledTimes(
    2 * (TW_SECTOR_INDICES.length + 1)
  );
  // Three of Fugle's 360-day ranges, so a year of weeks can be read twice over.
  expect(shiftDate(RECENT_FROM, -720)).toBe(SPAN_FROM);
  expect(candlesBetween).toHaveBeenCalledWith(
    { market: Market.TW, symbol: "IX0001" },
    RECENT_FROM,
    "2026-09-29"
  );
  expect(candlesBetween).toHaveBeenCalledWith(
    { market: Market.TW, symbol: "IX0001" },
    SPAN_FROM,
    shiftDate(RECENT_FROM, -1)
  );
  expect(set?.asOf).toBe("2026-09-29");
  expect(set?.sessions).toEqual([
    "2026-09-24",
    "2026-09-25",
    "2026-09-28",
    "2026-09-29",
  ]);
  expect(set?.entries.find((each) => each.symbol === "IX0028")).toEqual({
    sector: TwSector.Semiconductors,
    group: SectorGroup.Electronics,
    symbol: "IX0028",
    readings: EMPTY_READINGS,
  });

  clock.now = new Date(NOW.getTime() + MINUTE_MS - 1);
  const back = await rotations.sectors("2026-09-25");

  expect(candlesBetween).toHaveBeenCalledTimes(
    2 * (TW_SECTOR_INDICES.length + 1)
  );
  expect(back?.asOf).toBe("2026-09-25");
  expect(back?.sessions).toEqual(set?.sessions);
});

test("listings read each listing's daily bars and its market's index once, with the markets' sessions", async () => {
  const { rotations, candlesBetween } = setup();

  const symbols = [TSMC, { market: Market.TW, symbol: "2454" }];
  const set = await rotations.listings(symbols);

  expect(candlesBetween).toHaveBeenCalledTimes(2 * 3);
  expect(set.entries.map(({ symbol }) => symbol)).toEqual(symbols);
  expect(set.entries[0].benchmark).toEqual({
    market: Market.TW,
    symbol: "IX0001",
  });
  expect(set.entries[0].readings).toEqual(EMPTY_READINGS);
  expect(set.benchmark).toBeNull();
  expect(set.sessions).toHaveLength(4);
  expect(set.asOf).toBe("2026-09-29");
});

test("a listing is read against its own sector's index where its industry has one", async () => {
  const { rotations, candlesBetween } = setup();

  const view = await rotations.listing(TSMC);

  expect(view.index.name).toBe("TAIEX");
  expect(view.sector).toEqual({
    sector: TwSector.Semiconductors,
    symbol: "IX0028",
    readings: EMPTY_READINGS,
  });
  expect(candlesBetween).toHaveBeenCalledWith(
    { market: Market.TW, symbol: "IX0028" },
    RECENT_FROM,
    "2026-09-29"
  );

  const other = await rotations.listing({ market: Market.TW, symbol: "2454" });

  expect(other.sector).toBeNull();
});

test("listings may be read each against its own sector's index, and one outside those industries against none", async () => {
  const { rotations, candlesBetween } = setup();

  const set = await rotations.listings(
    [TSMC, { market: Market.TW, symbol: "2454" }],
    { against: RotationAgainst.Sector }
  );

  expect(set.entries[0].benchmark).toEqual({
    market: Market.TW,
    symbol: "IX0028",
  });
  expect(candlesBetween).toHaveBeenCalledWith(
    { market: Market.TW, symbol: "IX0028" },
    RECENT_FROM,
    "2026-09-29"
  );
  expect(set.entries[1]).toEqual({
    symbol: { market: Market.TW, symbol: "2454" },
    benchmark: null,
    readings: [],
  });
});

test("a benchmark other than the market's index must have traded on nearly every session of the last year", async () => {
  const { rotations, candlesBetween } = setup({
    IX0001: YEAR,
    "0050": YEAR.filter((_, i) => i % 50 !== 0),
    "6666": YEAR.filter((_, i) => i < 100 || i >= 104),
  });

  const fit = { market: Market.TW, symbol: "0050" };
  const set = await rotations.sectors(undefined, fit);

  expect(set?.benchmark).toEqual(fit);
  expect(candlesBetween).toHaveBeenCalledWith(fit, RECENT_FROM, "2026-09-29");

  await expect(
    rotations.sectors(undefined, { market: Market.TW, symbol: "6666" })
  ).rejects.toThrow(
    "TW 6666 cannot be a benchmark: it traded on 236 of the market's last 240 sessions and missed 4 in a row"
  );
  await expect(
    rotations.listings([TSMC], {
      benchmark: { market: Market.US, symbol: "SPY" },
    })
  ).rejects.toThrow("US SPY is not of TW 2330's market");
});

test("the sectors' history cuts each path to the sessions it plays back across, beside the benchmark's closes", async () => {
  const { rotations } = setup({ IX0001: YEAR, IX0028: wave(YEAR) });
  const answers = await answersOf(rotations.sectorHistory());
  const history = answers[0];

  // The cache held every year, so the history is answered once.
  expect(answers).toHaveLength(1);
  expect(history?.complete).toBe(true);

  const sessions = history?.sessions ?? [];
  const through = sessions[30];

  const semis = <Entry extends { symbol: string }>(
    entries: Entry[] | undefined
  ) => entries?.find(({ symbol }) => symbol === "IX0028");

  const paths = semis(history?.entries)?.paths ?? [];

  expect(sessions).toHaveLength(PLAYBACK_SESSIONS);
  expect(history?.closes).toEqual(sessions.map(() => 100));
  expect(paths[0].stops.filter(({ date }) => date < sessions[0])).toHaveLength(
    ROTATION_TRAIL - 1
  );
  expect(paths.map((path) => readingThrough(path))).toEqual(
    semis(await rotations.sectors().then((set) => set?.entries))?.readings
  );
  expect(paths.map((path) => readingThrough(path, through))).toEqual(
    semis(await rotations.sectors(through).then((set) => set?.entries))
      ?.readings
  );
});

test("listings' history gives the benchmark's closes only where every listing shares one", async () => {
  const { rotations } = setup({ IX0001: TAIEX });

  const [one] = await answersOf(
    rotations.listingHistory([TSMC, { market: Market.TW, symbol: "2454" }])
  );

  expect(one.closes).toEqual([23_000, 23_000, 23_000, 23_000]);
  expect(one.entries[0].paths).toHaveLength(EMPTY_READINGS.length);

  const [both] = await answersOf(
    rotations.listingHistory([TSMC, { market: Market.US, symbol: "AAPL" }])
  );

  expect(both.closes).toBeNull();
});

test("the whole span reaches back as far as every period's playback and trail need", async () => {
  const { rotations } = setup({ IX0001: SPAN, IX0028: wave(SPAN) });
  const [history] = await answersOf(rotations.sectorHistory());
  const first = history?.sessions[0] ?? "";

  const paths =
    history?.entries.find(({ symbol }) => symbol === "IX0028")?.paths ?? [];

  expect(paths).toHaveLength(EMPTY_READINGS.length);

  for (const path of paths) {
    expect(
      path.stops.filter(({ date }) => date < first).length,
      `${path.interval} ${path.period}`
    ).toBeGreaterThanOrEqual(ROTATION_TRAIL - 1);
  }
});

test("a history whose older years must come from the source shows the newest year first, then the whole span", async () => {
  let release: (() => void) | undefined;

  const sent = new Promise<void>((resolve) => {
    release = resolve;
  });

  const { rotations } = setup({ IX0001: SPAN, IX0028: wave(SPAN) }, () => sent);

  const stream = rotations.sectorHistory();
  const recent = await stream.next();

  release?.();

  const whole = await stream.next();
  const end = await stream.next();

  const weekly = (answer: typeof recent) =>
    (answer.done ? null : answer.value)?.entries
      .find(({ symbol }) => symbol === "IX0028")
      ?.paths.find(
        ({ interval, period }) =>
          interval === RotationInterval.Weekly && period === 52
      );

  expect(recent.value?.complete).toBe(false);
  expect(recent.value?.sessions).toEqual(whole.value?.sessions);
  expect(weekly(recent)?.stops).toEqual([]);
  expect(whole.value?.complete).toBe(true);
  expect(weekly(whole)?.stops.length).toBeGreaterThan(0);
  expect(end.done).toBe(true);
});

test("a history that fails for its older years fails after showing the newest year", async () => {
  const { rotations } = setup({ IX0001: SPAN }, () =>
    Promise.reject(new Error("Fugle answered 503"))
  );

  const stream = rotations.listingHistory([TSMC]);

  expect((await stream.next()).value?.complete).toBe(false);
  await expect(stream.next()).rejects.toThrow("Fugle answered 503");
});

test("sectors are null while no source covers Taiwan", async () => {
  const rotations = createRotations({
    candlesBetween: async () => [],
    sourceId: async () => null,
    company: async () => null,
  });

  expect(await rotations.sectors()).toBeNull();
});
