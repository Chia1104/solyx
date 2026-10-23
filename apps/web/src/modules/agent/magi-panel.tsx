import type { ReactNode } from "react";

import { cn } from "@heroui/react";
import { useTranslation } from "react-i18next";

import {
  CouncilOutcome,
  MagiUnit,
  MagiVote,
  councilOutcome,
} from "@solyx/core/council";
import type { Council, UnitVote } from "@solyx/core/council";
import type { ForecastScenario } from "@solyx/core/forecast";

// The units keep their own names in every language.
const UNIT_NAME: Record<MagiUnit, string> = {
  [MagiUnit.Melchior]: "MELCHIOR·1",
  [MagiUnit.Balthasar]: "BALTHASAR·2",
  [MagiUnit.Casper]: "CASPER·3",
};

// Ink for a vote in favour and hatching for one against, since red and green belong to prices.
const VOTE_FILL: Record<MagiVote, string> = {
  [MagiVote.Approve]: "bg-foreground text-background",
  [MagiVote.Reject]: "hatch",
};

const OUTCOME_FILL: Record<CouncilOutcome, string> = {
  [CouncilOutcome.Carried]: "bg-foreground text-background",
  [CouncilOutcome.Rejected]: "hatch",
  [CouncilOutcome.Undecided]: "border border-dashed border-border text-muted",
};

/** What was put to the units, and how they voted on it. */
interface Motion {
  subject: string;
  council: Council;
}

function UnitName({ unit }: { unit: MagiUnit }) {
  return (
    <span className="font-mono text-[0.6875rem] tracking-wider">
      {UNIT_NAME[unit]}
    </span>
  );
}

function VoteMark({ vote }: { vote: MagiVote | null }) {
  const { t } = useTranslation();

  return (
    <span
      className={cn(
        "shrink-0 px-1.5 py-0.5 text-xs font-medium",
        vote ? VOTE_FILL[vote] : "text-muted"
      )}>
      {t(`magi.votes.${vote ?? "abstained"}`)}
    </span>
  );
}

/** A motion's votes for and against. */
function Count({ council }: { council: Council }) {
  const { t } = useTranslation();

  const count = (cast: MagiVote) =>
    council.votes.filter(({ vote }) => vote === cast).length;

  return (
    <span className="text-xs text-muted tabular-nums">
      {t("magi.tally", {
        approved: count(MagiVote.Approve),
        rejected: count(MagiVote.Reject),
      })}
    </span>
  );
}

/** How a motion came out, with its votes for and against. */
function Tally({ council }: { council: Council }) {
  const { t } = useTranslation();

  return (
    <>
      <span className="font-medium">
        {t(`magi.${councilOutcome(council)}`)}
      </span>
      <Count council={council} />
    </>
  );
}

/*
 * The display's own layout: Balthasar above, Casper and Melchior below, each turning a bevelled
 * corner to the other two. Every unit is placed from the centre line, so the links between them
 * hold at any width and only the outer edges follow it. A unit's name sits on its square side and
 * its votes lean away from its bevel, which would otherwise cut them.
 */
const UNIT_PLACE: Record<
  MagiUnit,
  { cell: string; votes: string; vote: string }
> = {
  [MagiUnit.Balthasar]: {
    cell: "top-0 left-1/2 h-29 w-28 -translate-x-1/2 flex-col items-center rounded-b-[1.75rem]",
    votes: "rounded-b-[1.6875rem]",
    vote: "justify-center",
  },
  [MagiUnit.Casper]: {
    cell: "bottom-0 left-0 right-[calc(50%+2.1875rem)] h-29.25 flex-col-reverse items-start rounded-tr-[2.25rem]",
    votes: "rounded-tr-[2.1875rem]",
    vote: "justify-start",
  },
  [MagiUnit.Melchior]: {
    cell: "bottom-0 right-0 left-[calc(50%+2.1875rem)] h-29.25 flex-col-reverse items-end rounded-tl-[2.25rem]",
    votes: "rounded-tl-[2.1875rem]",
    vote: "justify-end",
  },
};

/** A unit's cell, filled by its vote on each motion in the motions' order. */
function Cell({
  unit,
  motions,
}: {
  unit: MagiUnit;
  motions: readonly Motion[];
}) {
  const { t } = useTranslation();
  const place = UNIT_PLACE[unit];
  const numbered = motions.length > 1;

  return (
    <div
      className={cn(
        "absolute flex border border-foreground [corner-shape:bevel]",
        place.cell
      )}>
      <span className="px-1.5 font-mono text-[0.625rem]/4 tracking-wide">
        {UNIT_NAME[unit]}
      </span>
      <div
        className={cn(
          "@container m-0.5 flex min-h-0 flex-1 flex-col gap-0.5 self-stretch overflow-clip [corner-shape:bevel]",
          place.votes
        )}>
        {motions.map(({ subject, council }, index) => {
          const vote =
            council.votes.find((cast) => cast.unit === unit)?.vote ?? null;

          return (
            <span
              key={subject}
              className={cn(
                "flex min-h-0 flex-1 items-center gap-1 px-1.5 font-mincho font-bold whitespace-nowrap",
                numbered
                  ? "text-xs"
                  : "justify-center text-[clamp(0.8125rem,17cqw,1.125rem)]",
                numbered && place.vote,
                vote ? VOTE_FILL[vote] : "text-muted"
              )}>
              {numbered ? (
                <span className="font-mono text-[0.625rem] font-normal">
                  {index + 1}
                </span>
              ) : null}
              {t(`magi.votes.${vote ?? "abstained"}`)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** How a motion came out, stamped as its votes are. */
function Stamp({
  council,
  className,
}: {
  council: Council;
  className: string;
}) {
  const { t } = useTranslation();
  const outcome = councilOutcome(council);

  return (
    <span
      className={cn(
        "font-mincho font-bold whitespace-nowrap",
        OUTCOME_FILL[outcome],
        className
      )}>
      {t(`magi.${outcome}`)}
    </span>
  );
}

/** One side of the board's head: what was moved on the left, what was resolved on the right. */
function Docket({
  title,
  className,
  children,
}: {
  title: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "@container absolute top-0 flex w-[calc(50%-3.875rem)] flex-col gap-1",
        className
      )}>
      {/* Sized by the room beside Balthasar, so a title in Latin capitals fits where two characters do. */}
      <span className="self-stretch border-y-3 border-double border-foreground font-mincho text-[clamp(0.8125rem,19cqw,1.125rem)]/5 font-bold tracking-wider whitespace-nowrap uppercase">
        {title}
      </span>
      {children}
    </div>
  );
}

/** The three units around their name, as the MAGI's own display draws a vote. */
function Board({ motions }: { motions: readonly Motion[] }) {
  const { t } = useTranslation();
  const numbered = motions.length > 1;

  return (
    // The minutes under the board say all of it again in words.
    <div aria-hidden className="relative h-53 max-w-md select-none">
      <Docket title={t("magi.motion")} className="left-0">
        <ol className="flex flex-col text-[0.6875rem]/3.5">
          {motions.map(({ subject }, index) => (
            <li key={subject} className="flex gap-1">
              {numbered ? (
                <span className="font-mono text-[0.625rem]/3.5">
                  {index + 1}
                </span>
              ) : null}
              <span
                className={cn(
                  "min-w-0",
                  numbered ? "truncate" : "line-clamp-3"
                )}>
                {subject}
              </span>
            </li>
          ))}
        </ol>
      </Docket>
      <Docket
        title={t("magi.resolution")}
        className="right-0 items-end text-right">
        <ol className="flex flex-col items-end gap-px text-[0.6875rem]/3.5">
          {motions.map(({ subject, council }, index) =>
            numbered ? (
              <li key={subject} className="flex items-center gap-0.5">
                <span className="font-mono text-[0.625rem]/3.5">
                  {index + 1}
                </span>
                <Stamp council={council} className="px-0.5" />
              </li>
            ) : (
              <li key={subject} className="flex flex-col items-end gap-1">
                <Stamp
                  council={council}
                  className="px-1.5 text-[clamp(0.6875rem,17cqw,1rem)]/6"
                />
                <Count council={council} />
              </li>
            )
          )}
        </ol>
      </Docket>
      {Object.values(MagiUnit).map((unit) => (
        <Cell key={unit} unit={unit} motions={motions} />
      ))}
      {/* The links, each across the gap between two units' facing edges. */}
      <span className="absolute top-[6.53125rem] left-[calc(50%-3.59375rem)] h-1.5 w-5 -rotate-45 bg-foreground" />
      <span className="absolute top-[6.53125rem] left-[calc(50%+2.34375rem)] h-1.5 w-5 rotate-45 bg-foreground" />
      <span className="absolute top-44 left-[calc(50%-2.25rem)] h-1.5 w-18 bg-foreground" />
      <span className="absolute top-34 left-1/2 -translate-x-1/2 font-mincho text-[0.9375rem]/5 font-bold tracking-widest">
        {t("magi.title")}
      </span>
    </div>
  );
}

function Unit({ vote }: { vote: UnitVote }) {
  const { t } = useTranslation();

  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <UnitName unit={vote.unit} />
        <span className="text-xs text-muted">
          {t(`magi.personas.${vote.unit}`)}
        </span>
        <span className="ml-auto flex">
          <VoteMark vote={vote.vote} />
        </span>
      </div>
      <p className="text-xs text-muted">{vote.reason}</p>
    </li>
  );
}

/** A motion's three votes on the board, over each unit's reason. */
export function MagiPanel({ council }: { council: Council }) {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t("magi.title")}
      className="flex max-w-md flex-col gap-2.5 text-sm">
      <Board motions={[{ subject: t("magi.order"), council }]} />
      <p className="sr-only">
        <Tally council={council} />
      </p>
      <ul className="flex flex-col gap-2">
        {council.votes.map((vote) => (
          <Unit key={vote.unit} vote={vote} />
        ))}
      </ul>
    </section>
  );
}

/** The vote on each of a forecast's scenarios, each a motion of its own, with every unit's reason. */
export function MagiScenarios({
  scenarios,
  motions,
}: {
  scenarios: readonly ForecastScenario[];
  /** In the scenarios' order. */
  motions: readonly Council[];
}) {
  const { t } = useTranslation();

  const docket = motions.map((council, index) => ({
    subject: scenarios[index]?.label ?? String(index + 1),
    council,
  }));

  return (
    <section
      aria-label={t("magi.title")}
      className="@container flex flex-col gap-2.5 text-sm">
      <p className="text-xs text-muted">{t("magi.question")}</p>
      <Board motions={docket} />
      <ol className="flex flex-col gap-2.5">
        {docket.map(({ subject, council }, index) => (
          <li key={subject} className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[0.6875rem]">{index + 1}</span>
              <span className="min-w-0 truncate">{subject}</span>
              <Tally council={council} />
            </div>
            <ul className="flex flex-col gap-1 border-l border-separator pl-2.5">
              {council.votes.map((vote) => (
                <li
                  key={vote.unit}
                  className="flex flex-col gap-x-2 gap-y-0.5 @sm:grid @sm:grid-cols-[7.5rem_auto_minmax(0,1fr)] @sm:items-baseline">
                  {/* A reason gets the whole row where three columns would squeeze it. */}
                  <div className="flex items-center gap-2 @sm:contents">
                    <UnitName unit={vote.unit} />
                    <VoteMark vote={vote.vote} />
                  </div>
                  <p className="text-xs text-muted">{vote.reason}</p>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
