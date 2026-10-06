import { Market, exchangeClock, exchangeMidnight } from "./market.ts";

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

const REGULAR_WINDOWS: Record<Market, SessionWindow> = {
  [Market.TW]: sessionWindow(Session.Regular, "09:00", "13:30"),
  [Market.US]: sessionWindow(Session.Regular, "09:30", "16:00"),
};

// Exchange holidays, typhoon closures and US early closes are not modelled yet.
const SESSION_WINDOWS: Record<Market, SessionWindow[]> = {
  // Pre-open matching → regular session → after-hours fixed-price trading
  [Market.TW]: [
    sessionWindow(Session.Pre, "08:30", "09:00"),
    REGULAR_WINDOWS[Market.TW],
    sessionWindow(Session.Post, "14:00", "14:30"),
  ],
  [Market.US]: [
    sessionWindow(Session.Pre, "04:00", "09:30"),
    REGULAR_WINDOWS[Market.US],
    sessionWindow(Session.Post, "16:00", "20:00"),
  ],
};

export function getSession(market: Market, at: Date = new Date()): Session {
  const { weekday, hour, minute } = exchangeClock(market, at);
  const minutes = Number(hour) * 60 + Number(minute);

  if (weekday === "Sat" || weekday === "Sun") return Session.Closed;

  return (
    SESSION_WINDOWS[market].find((w) => minutes >= w.start && minutes < w.end)
      ?.session ?? Session.Closed
  );
}

/** The UTC seconds at which the regular session of `date`, exchange-local `YYYY-MM-DD`, opens and closes. */
export function regularHours(market: Market, date: string) {
  const midnight = exchangeMidnight(market, date);
  const { start, end } = REGULAR_WINDOWS[market];

  return { open: midnight + start * 60, close: midnight + end * 60 };
}
