import { Market } from "./market.ts";

export const Session = {
  Pre: "pre",
  Regular: "regular",
  Post: "post",
  Closed: "closed",
} as const;

export type Session = (typeof Session)[keyof typeof Session];

interface SessionWindow {
  session: Exclude<Session, typeof Session.Closed>;
  start: number;
  end: number;
}

function sessionWindow(
  session: SessionWindow["session"],
  start: string,
  end: string
): SessionWindow {
  const minutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);

    return h * 60 + m;
  };

  return { session, start: minutes(start), end: minutes(end) };
}

// Exchange holidays, typhoon closures and US early closes are not modelled yet.
const SCHEDULES: Record<
  Market,
  { timeZone: string; windows: SessionWindow[] }
> = {
  // Pre-open matching → regular session → after-hours fixed-price trading
  [Market.TW]: {
    timeZone: "Asia/Taipei",
    windows: [
      sessionWindow(Session.Pre, "08:30", "09:00"),
      sessionWindow(Session.Regular, "09:00", "13:30"),
      sessionWindow(Session.Post, "14:00", "14:30"),
    ],
  },
  [Market.US]: {
    timeZone: "America/New_York",
    windows: [
      sessionWindow(Session.Pre, "04:00", "09:30"),
      sessionWindow(Session.Regular, "09:30", "16:00"),
      sessionWindow(Session.Post, "16:00", "20:00"),
    ],
  },
};

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

function localClock(timeZone: string, at: Date) {
  let formatter = clockFormatters.get(timeZone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    });
    clockFormatters.set(timeZone, formatter);
  }

  const parts = Object.fromEntries(
    formatter.formatToParts(at).map((p) => [p.type, p.value])
  );

  return {
    weekday: parts.weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function getSession(market: Market, at: Date = new Date()): Session {
  const { timeZone, windows } = SCHEDULES[market];
  const { weekday, minutes } = localClock(timeZone, at);

  if (weekday === "Sat" || weekday === "Sun") return Session.Closed;

  return (
    windows.find((w) => minutes >= w.start && minutes < w.end)?.session ??
    Session.Closed
  );
}
