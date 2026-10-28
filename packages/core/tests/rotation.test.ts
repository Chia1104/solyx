import { describe, expect, test } from "vite-plus/test";

import type { Candle } from "../src/candles.ts";
import { Market } from "../src/market.ts";
import {
  Quadrant,
  ROTATION_PERIODS,
  ROTATION_TRAIL,
  RotationInterval,
  benchmarkFitness,
  dateBars,
  lastTransition,
  playbackPath,
  quadrantOf,
  readEveryRotation,
  readingThrough,
  rollingZ,
  rotation,
  rotationPath,
  rotationPaths,
  rotationSeries,
  weekUnderWay,
} from "../src/rotation.ts";
import { weekdays } from "../src/session.ts";

const taipei = (date: string) => Date.parse(`${date}T00:00:00+08:00`) / 1000;

/** Daily bars from 2026-01-05 on, one per weekday, closing at each of `closes`. */
function bars(closes: readonly number[]): Candle[] {
  const day = new Date("2026-01-05T00:00:00Z");

  return closes.map((close) => {
    while (day.getUTCDay() % 6 === 0) day.setUTCDate(day.getUTCDate() + 1);

    const time = taipei(day.toISOString().slice(0, 10));

    day.setUTCDate(day.getUTCDate() + 1);

    return { time, open: close, high: close, low: close, close, volume: 0 };
  });
}

describe("rollingZ", () => {
  test("scores the last value of each window in population standard deviations", () => {
    const line = rollingZ([1, 2, 3, 4, 5], 3);

    expect(line.slice(0, 2)).toEqual([null, null]);
    // The last of 1, 2, 3 is one deviation (sqrt(2/3)) above their mean of 2.
    expect(line[2]).toBeCloseTo(1 / Math.sqrt(2 / 3));
    expect(line[3]).toBeCloseTo(1 / Math.sqrt(2 / 3));
  });

  test("is null while the window holds a null or does not vary", () => {
    const line = rollingZ([1, null, 3, 4, 5], 3);

    expect(line.slice(0, 4)).toEqual([null, null, null, null]);
    expect(line[4]).toBeCloseTo(1 / Math.sqrt(2 / 3));
    expect(rollingZ([2, 2, 2], 3)).toEqual([null, null, null]);
    expect(rollingZ([1e9, 1e9 + 1e-7, 1e9 + 2e-7], 3)).toEqual([
      null,
      null,
      null,
    ]);
  });

  test("reads a long drifting series as each window read on its own would", () => {
    const values = Array.from(
      { length: 400 },
      (_, i) => 1.2 + 0.3 * Math.sin(i / 7) + i / 1000
    );

    const line = rollingZ(values, 60);

    for (let i = 59; i < values.length; i += 37) {
      const window = values.slice(i - 59, i + 1);
      const mean = window.reduce((sum, each) => sum + each, 0) / 60;

      const variance =
        window.reduce((sum, each) => sum + (each - mean) ** 2, 0) / 60;

      expect(line[i]).toBeCloseTo((values[i] - mean) / Math.sqrt(variance), 9);
    }
  });

  test("a flat stretch inside a varying series reads as no variation", () => {
    const values = [1, 2, 3, 2, 2, 2, 2, 5];
    const line = rollingZ(values, 4);

    expect(line[5]).not.toBeNull();
    expect(line[6]).toBeNull();
    expect(line[7]).not.toBeNull();
  });

  test("scores a window of large values as it would the same window shifted to zero", () => {
    const shifted = rollingZ([1e6 + 1, 1e6 + 2, 1e6 + 4, 1e6 + 8], 4)[3];

    expect(shifted).toBeCloseTo(rollingZ([1, 2, 4, 8], 4)[3]!, 10);
  });
});

describe("rotation", () => {
  test("takes twice the period to give both coordinates", () => {
    const values = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
    const benchmark = values.map(() => 1);
    const { level, momentum } = rotation(values, benchmark, 3);

    expect(level.slice(0, 2)).toEqual([null, null]);
    expect(level[2]).not.toBeNull();
    expect(momentum.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(momentum[5]).not.toBeNull();
  });

  test("reads the ratio, so a listing that keeps pace with its benchmark does not move", () => {
    const values = [10, 11, 12, 13, 14, 15, 16, 17];
    const { level, momentum } = rotation(values, values, 3);

    expect(level.every((each) => each === null)).toBe(true);
    expect(momentum.every((each) => each === null)).toBe(true);
  });

  test("a bar the benchmark lacks breaks every window it falls in", () => {
    const values = [1, 2, 4, 8, 16, 32, 64, 128];
    const benchmark: (number | null)[] = values.map(() => 1);

    benchmark[3] = null;

    const { level } = rotation(values, benchmark, 3);

    expect(level[2]).not.toBeNull();
    expect(level.slice(3, 6)).toEqual([null, null, null]);
    expect(level[6]).not.toBeNull();
  });
});

describe("quadrants", () => {
  test("meet at the origin, which counts as leading", () => {
    expect(quadrantOf(0, 0)).toBe(Quadrant.Leading);
    expect(quadrantOf(1, -1)).toBe(Quadrant.Weakening);
    expect(quadrantOf(-1, -1)).toBe(Quadrant.Lagging);
    expect(quadrantOf(-1, 1)).toBe(Quadrant.Improving);
  });

  test("lastTransition names the last crossing between consecutive stops", () => {
    const stops = [
      { date: "2026-01-05", level: -1, momentum: -1 },
      { date: "2026-01-06", level: -1, momentum: 1 },
      { date: "2026-01-07", level: 1, momentum: 1 },
      { date: "2026-01-08", level: 2, momentum: 1 },
    ];

    expect(lastTransition(stops)).toEqual({
      from: Quadrant.Improving,
      to: Quadrant.Leading,
      date: "2026-01-07",
    });
    expect(lastTransition(stops.slice(2))).toBeNull();
    expect(lastTransition([])).toBeNull();
  });
});

describe("readingThrough", () => {
  // A listing that gains on a flat benchmark faster and faster, then slips a little each session.
  const closes = [
    100, 100.5, 101, 101.5, 102, 103, 104, 105.5, 107, 109, 111, 114, 117, 121,
    125, 124.5, 124, 123.5, 123, 122.5,
  ];

  // The Monday after the bars, whose week is under way.
  const OPEN_WEEK = "2026-02-02";
  const listing = bars(closes);
  const benchmark = bars(closes.map(() => 1000));

  const daily = (candles: Candle[]) =>
    rotationSeries(dateBars(Market.TW, candles), RotationInterval.Daily, null);

  test("dates each stop and names the newest quadrant and the last crossing", () => {
    const reading = readingThrough(
      rotationPath(daily(listing), daily(benchmark), 4)
    );

    expect(reading.interval).toBe(RotationInterval.Daily);
    expect(reading.period).toBe(4);
    expect(reading.trail).toHaveLength(ROTATION_TRAIL);
    expect(reading.trail[0]?.date).toBe("2026-01-19");
    expect(reading.trail.at(-1)?.date).toBe("2026-01-30");
    // The slip holds the ratio at its window's floor, but the level's fall has stopped, which
    // stands above the falls before it: improving, as the graph reads it, not rising.
    expect(reading.quadrant).toBe(Quadrant.Improving);
    expect(reading.transition).toEqual({
      from: Quadrant.Lagging,
      to: Quadrant.Improving,
      date: "2026-01-29",
    });
  });

  test("gives an empty trail while the bars are too few", () => {
    const reading = readingThrough(
      rotationPath(daily(listing.slice(0, 7)), daily(benchmark), 4)
    );

    expect(reading).toEqual({
      interval: RotationInterval.Daily,
      period: 4,
      trail: [],
      quadrant: null,
      transition: null,
    });
  });

  test("matches the benchmark's bars by time rather than by position", () => {
    const whole = readingThrough(
      rotationPath(daily(listing), daily(benchmark), 4)
    );

    const offset = readingThrough(
      rotationPath(daily(listing), daily(benchmark.slice(2)), 4)
    );

    expect(offset.trail.map(({ date }) => date)).toEqual(
      whole.trail.map(({ date }) => date)
    );

    // The sums are centred on the first ratio read, which the offset moves, so only rounding differs.
    for (const [i, stop] of offset.trail.entries()) {
      expect(stop.level).toBeCloseTo(whole.trail[i].level, 9);
      expect(stop.momentum).toBeCloseTo(whole.trail[i].momentum, 9);
    }
  });

  test("rotationPaths reads every period of both intervals", () => {
    const paths = rotationPaths(
      dateBars(Market.TW, listing),
      dateBars(Market.TW, benchmark),
      OPEN_WEEK
    );

    expect(
      paths.map(({ interval, period }) => `${interval}:${period}`)
    ).toEqual(["1d:20", "1d:60", "1d:120", "1w:13", "1w:26", "1w:52"]);
    expect(
      paths.filter(({ interval }) => interval === RotationInterval.Daily)
    ).toEqual(
      ROTATION_PERIODS[RotationInterval.Daily].map((period) =>
        rotationPath(daily(listing), daily(benchmark), period)
      )
    );
  });
});

describe("readEveryRotation as of a session", () => {
  // Two hundred sessions from 2026-01-05 to 2026-10-09, which hold a quarter of weeks' reading and its trail.
  const closes = Array.from({ length: 200 }, (_, i) => 100 + i * (i % 3));
  const listing = bars(closes);
  const benchmark = bars(closes.map(() => 1000));
  const AT = new Date("2026-10-12T10:00:00+08:00");

  const upTo = (candles: Candle[], through: string) =>
    dateBars(
      Market.TW,
      candles.filter((bar) => bar.time <= taipei(through))
    );

  // A Friday, read once its week has closed, and the Wednesday after, while its week was under way.
  test.each([
    ["2026-09-18", "2026-09-21"],
    ["2026-09-23", "2026-09-23"],
  ])("reads as the bars up to %s alone would on %s", (through, then) => {
    const back = readEveryRotation(
      dateBars(Market.TW, listing),
      dateBars(Market.TW, benchmark),
      { at: AT, through }
    );

    const alone = readEveryRotation(
      upTo(listing, through),
      upTo(benchmark, through),
      { at: new Date(`${then}T10:00:00+08:00`) }
    );

    expect(back.find(({ period }) => period === 20)?.trail.at(-1)?.date).toBe(
      through
    );
    expect(back).toEqual(alone);
  });

  test("leaves out the week a session falls inside", () => {
    const [weekly] = readEveryRotation(
      dateBars(Market.TW, listing),
      dateBars(Market.TW, benchmark),
      { at: AT, through: "2026-09-23" }
    ).filter(({ interval }) => interval === RotationInterval.Weekly);

    expect(weekly.trail.at(-1)?.date).toBe("2026-09-18");
  });
});

describe("weekUnderWay", () => {
  const at = (moment: string) => new Date(`${moment}+08:00`);

  test.each([
    ["Monday before the open", "2026-10-19T08:00:00", "2026-10-19"],
    ["Thursday after the close", "2026-10-22T14:00:00", "2026-10-19"],
    ["Friday through its session", "2026-10-23T13:00:00", "2026-10-19"],
    ["Friday after the close", "2026-10-23T14:00:00", null],
    ["Saturday", "2026-10-24T10:00:00", null],
    ["Sunday", "2026-10-25T10:00:00", null],
  ])("on %s", (_, moment, week) => {
    expect(weekUnderWay(Market.TW, at(moment))).toBe(week);
  });

  test("closes the week with its last trading day's session", () => {
    // The Friday is a holiday, so Thursday's close ends the week.
    const trades = Object.assign(
      (date: string) => date !== "2026-10-23" && weekdays(date),
      { closesEarly: () => false }
    );

    expect(
      weekUnderWay(Market.TW, at("2026-10-22T14:00:00"), trades)
    ).toBeNull();
  });
});

describe("playbackPath", () => {
  const path = {
    interval: RotationInterval.Daily,
    period: 4,
    stops: Array.from({ length: 30 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      level: i,
      momentum: i,
    })),
  };

  test("keeps what a reading as of the first session or a later one draws on", () => {
    const cut = playbackPath(path, "2026-01-20");

    expect(cut.stops[0].date).toBe("2026-01-11");

    for (const through of ["2026-01-20", "2026-01-25", "2026-01-30"]) {
      expect(readingThrough(cut, through)).toEqual(
        readingThrough(path, through)
      );
    }
  });

  test("keeps the last trail where every stop is older than the first session", () => {
    expect(playbackPath(path, "2026-02-10").stops).toHaveLength(ROTATION_TRAIL);
  });
});

describe("rotationSeries", () => {
  // Four weeks of sessions from Monday 2026-01-05, the fourth missing its Monday, then a Monday.
  const closes = Array.from({ length: 21 }, (_, i) => 100 + i);
  const daily = bars(closes).filter((_, i) => i !== 15);

  test("merges sessions into closed weeks dated by their last session, matched by their first day", () => {
    const weekly = rotationSeries(
      dateBars(Market.TW, daily),
      RotationInterval.Weekly,
      "2026-02-02"
    );

    expect(weekly.keys).toEqual([
      "2026-01-05",
      "2026-01-12",
      "2026-01-19",
      "2026-01-26",
    ]);
    expect(weekly.dates).toEqual([
      "2026-01-09",
      "2026-01-16",
      "2026-01-23",
      "2026-01-30",
    ]);
    expect(weekly.bars.map(({ close }) => close)).toEqual([104, 109, 114, 119]);
    // The fourth week opened on its Tuesday, which is no reason to match it apart from the others.
    expect(weekly.bars[3].open).toBe(116);
  });

  test("leaves out the week under way", () => {
    const weekly = rotationSeries(
      dateBars(Market.TW, daily.slice(0, -1)),
      RotationInterval.Weekly,
      "2026-01-26"
    );

    expect(weekly.keys).toEqual(["2026-01-05", "2026-01-12", "2026-01-19"]);
  });

  test("keeps sessions as they are, keyed by their time", () => {
    const series = rotationSeries(
      dateBars(Market.TW, daily.slice(0, 2)),
      RotationInterval.Daily,
      null
    );

    expect(series.keys).toEqual(
      daily.slice(0, 2).map(({ time }) => String(time))
    );
    expect(series.dates).toEqual(["2026-01-05", "2026-01-06"]);
  });
});

describe("benchmarkFitness", () => {
  const calendar = bars(Array.from({ length: 250 }, () => 1000));

  test("a listing that traded nearly every session with no long halt qualifies", () => {
    const listing = calendar.filter((_, i) => i % 40 !== 0);
    const fitness = benchmarkFitness(Market.TW, calendar, listing);

    expect(fitness).toEqual({
      sessions: 240,
      traded: 234,
      longestGap: 1,
      fit: true,
    });
  });

  test("too few sessions traded, a halt of four, or a short calendar disqualify", () => {
    expect(
      benchmarkFitness(Market.TW, calendar, calendar.slice(0, 230)).fit
    ).toBe(false);
    expect(
      benchmarkFitness(
        Market.TW,
        calendar,
        calendar.filter((_, i) => i < 100 || i >= 104)
      )
    ).toMatchObject({ traded: 236, longestGap: 4, fit: false });
    expect(
      benchmarkFitness(Market.TW, calendar.slice(0, 100), calendar).fit
    ).toBe(false);
  });

  test("reads the sessions up to `through` alone", () => {
    const through = "2026-11-20";
    const fitness = benchmarkFitness(Market.TW, calendar, calendar, through);

    expect(fitness.sessions).toBe(230);
    expect(fitness.fit).toBe(false);
  });
});
