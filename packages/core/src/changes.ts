import { uniqBy } from "es-toolkit";

import { exchangeDate } from "./market.ts";
import type { SymbolRef } from "./market.ts";
import { CLAIM_SUPPORT_LINE } from "./report.ts";
import type { Report } from "./report.ts";
import type { FalsifierCheck } from "./research.ts";
import type { ThemeWatch } from "./theme.ts";

/** What can change in what the app keeps while nobody looks. */
export const ChangeKind = {
  /** News read as stating one of a report's falsifiers. */
  FalsifierMet: "falsifier-met",
  /** The day of one of a report's events went by. */
  EventPassed: "event-passed",
  /** News read as stating one of a theme's signposts. */
  SignpostMet: "signpost-met",
} as const;

export type ChangeKind = (typeof ChangeKind)[keyof typeof ChangeKind];

/** One thing that changed, with enough to say which. */
export type Change =
  | {
      kind: typeof ChangeKind.FalsifierMet;
      symbol: SymbolRef;
      falsifier: string;
    }
  | {
      kind: typeof ChangeKind.EventPassed;
      symbol: SymbolRef;
      /** Exchange-local date, `YYYY-MM-DD`. */
      date: string;
      label: string;
    }
  | { kind: typeof ChangeKind.SignpostMet; theme: string; signpost: string };

/** What the app keeps that can change on its own. */
export interface Watched {
  /** Each listing's report in force with every reading of its falsifiers. */
  reports: readonly { report: Report; checks: readonly FalsifierCheck[] }[];
  themes: readonly ThemeWatch[];
}

/**
 * What changed after `since` as of `now`, both epoch ms, read from what the app already keeps, so
 * telling costs no request: a falsifier or a signpost that news was read as stating since then,
 * each once however many items state it, and an event whose day went by since the day of `since`
 * on its exchange.
 */
export function changesSince(
  since: number,
  now: number,
  { reports, themes }: Watched
): Change[] {
  const researched = reports.flatMap(({ report, checks }): Change[] => {
    const { symbol } = report;
    const { market } = symbol;
    const today = exchangeDate(market, new Date(now));
    const then = exchangeDate(market, new Date(since));

    return [
      ...uniqBy(
        checks.filter(
          ({ falsifier, revision, support, checkedAt }) =>
            revision === report.revision &&
            checkedAt > since &&
            support.supported >= CLAIM_SUPPORT_LINE &&
            report.falsifiers.includes(falsifier)
        ),
        ({ falsifier }) => falsifier
      ).map(({ falsifier }) => ({
        kind: ChangeKind.FalsifierMet,
        symbol,
        falsifier,
      })),
      ...report.events
        .filter(({ date }) => date < today && date >= then)
        .map(({ date, label }) => ({
          kind: ChangeKind.EventPassed,
          symbol,
          date,
          label,
        })),
    ];
  });

  const watched = themes.flatMap(({ theme, developments }): Change[] =>
    uniqBy(
      developments.filter(({ checkedAt }) => checkedAt > since),
      ({ signpost }) => signpost
    ).map(({ signpost }) => ({
      kind: ChangeKind.SignpostMet,
      theme: theme.title,
      signpost,
    }))
  );

  return [...researched, ...watched];
}

const listing = ({ market, symbol }: SymbolRef) => `${market} ${symbol}`;

/** A change in a line, worded for the model. */
export function changeText(change: Change): string {
  switch (change.kind) {
    case ChangeKind.FalsifierMet:
      return `${listing(change.symbol)}: news may state the falsifier "${change.falsifier}"`;
    case ChangeKind.EventPassed:
      return `${listing(change.symbol)}: the event "${change.label}" of ${change.date} has passed`;
    case ChangeKind.SignpostMet:
      return `theme "${change.theme}": news may state the signpost "${change.signpost}"`;
  }
}
