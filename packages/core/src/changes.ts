import { uniqBy } from "es-toolkit";
import * as z from "zod";

import { exchangeDate, symbolKey, symbolRefSchema } from "./market.ts";
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

/** The kinds a listing's report makes, as against a theme's. */
const OF_LISTINGS: readonly ChangeKind[] = [
  ChangeKind.FalsifierMet,
  ChangeKind.EventPassed,
];

// As many as a task would reasonably name; more is every one.
const SCOPE_LIMIT = 50;

/** Which changes a task that waits on one runs for. */
export const changeScopeSchema = z.object({
  kinds: z.array(z.enum(ChangeKind)).min(1),
  /** The listings whose reports it watches; `null` for every listing the user holds and watches. */
  listings: z.array(symbolRefSchema).min(1).max(SCOPE_LIMIT).nullable(),
  /** The themes whose signposts it watches, by id; `null` for every theme. */
  themes: z.array(z.string().min(1)).min(1).max(SCOPE_LIMIT).nullable(),
});

export type ChangeScope = z.infer<typeof changeScopeSchema>;

/** Every kind, of every listing the user follows and every theme. */
export const EVERY_CHANGE: ChangeScope = {
  kinds: Object.values(ChangeKind),
  listings: null,
  themes: null,
};

/** Whether the scope runs for a change to a listing's report. */
export const watchesListings = ({ kinds }: Pick<ChangeScope, "kinds">) =>
  kinds.some((kind) => OF_LISTINGS.includes(kind));

/** Whether the scope runs for a change to a theme. */
export const watchesThemes = ({ kinds }: Pick<ChangeScope, "kinds">) =>
  kinds.includes(ChangeKind.SignpostMet);

/** What the app keeps that can change on its own. */
export interface Watched {
  /** Each listing's report in force with every reading of its falsifiers. */
  reports: readonly { report: Report; checks: readonly FalsifierCheck[] }[];
  themes: readonly ThemeWatch[];
}

/**
 * What changed within `scope` after `since` as of `now`, both epoch ms, read from what the app
 * already keeps, so telling costs no request: a falsifier or a signpost that news was read as
 * stating since then, each once however many items state it, and an event whose day went by since
 * the day of `since` on its exchange.
 */
export function changesSince(
  since: number,
  now: number,
  { reports, themes }: Watched,
  scope: ChangeScope
): Change[] {
  const named = scope.listings?.map(symbolKey);

  const scoped = reports.filter(
    ({ report }) =>
      named === undefined || named.includes(symbolKey(report.symbol))
  );

  const researched = scoped.flatMap(({ report, checks }): Change[] => {
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

  const watched = themes
    .filter(({ theme }) => scope.themes?.includes(theme.id) ?? true)
    .flatMap(({ theme, developments }): Change[] =>
      uniqBy(
        developments.filter(({ checkedAt }) => checkedAt > since),
        ({ signpost }) => signpost
      ).map(({ signpost }) => ({
        kind: ChangeKind.SignpostMet,
        theme: theme.title,
        signpost,
      }))
    );

  return [...researched, ...watched].filter(({ kind }) =>
    scope.kinds.includes(kind)
  );
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
