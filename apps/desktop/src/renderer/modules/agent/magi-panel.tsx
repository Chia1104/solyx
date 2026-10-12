import { cn } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { MagiUnit, MagiVote, councilOutcome } from "@solyx/core/council";
import type { Council, UnitVote } from "@solyx/core/council";
import type { ForecastScenario } from "@solyx/core/forecast";

// The units keep their own names in every language.
const UNIT_NAME: Record<MagiUnit, string> = {
  [MagiUnit.Melchior]: "MELCHIOR·1",
  [MagiUnit.Balthasar]: "BALTHASAR·2",
  [MagiUnit.Casper]: "CASPER·3",
};

function UnitName({ unit }: { unit: MagiUnit }) {
  return (
    <span className="font-mono text-[0.6875rem] tracking-wider">
      {UNIT_NAME[unit]}
    </span>
  );
}

/** Ink for a vote in favour and hatching for one against, since red and green belong to prices. */
function VoteMark({ vote }: { vote: MagiVote | null }) {
  const { t } = useTranslation();

  return (
    <span
      className={cn(
        "shrink-0 px-1.5 py-0.5 text-xs font-medium",
        vote === MagiVote.Approve && "bg-foreground text-background",
        vote === MagiVote.Reject && "hatch",
        vote === null && "text-muted"
      )}>
      {t(`magi.votes.${vote ?? "abstained"}`)}
    </span>
  );
}

/** How a motion came out, with its votes for and against. */
function Tally({ council }: { council: Council }) {
  const { t } = useTranslation();

  const count = (cast: MagiVote) =>
    council.votes.filter(({ vote }) => vote === cast).length;

  return (
    <>
      <span className="font-medium">
        {t(`magi.${councilOutcome(council)}`)}
      </span>
      <span className="text-xs text-muted tabular-nums">
        {t("magi.tally", {
          approved: count(MagiVote.Approve),
          rejected: count(MagiVote.Reject),
        })}
      </span>
    </>
  );
}

function Unit({ vote }: { vote: UnitVote }) {
  const { t } = useTranslation();

  return (
    <li
      className={cn(
        "flex flex-col gap-1 border border-separator px-2.5 py-2",
        vote.vote === MagiVote.Approve && "border-foreground",
        vote.vote === null && "border-dashed"
      )}>
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

/** A motion's three votes with each unit's reason, under how the vote came out. */
export function MagiPanel({ council }: { council: Council }) {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t("magi.title")}
      className="flex flex-col gap-1.5 text-sm">
      <header className="flex items-baseline gap-2">
        <span className="font-mono text-xs tracking-widest">
          {t("magi.title")}
        </span>
        <Tally council={council} />
      </header>
      <ul className="flex flex-col gap-1.5">
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

  return (
    <section
      aria-label={t("magi.title")}
      className="flex flex-col gap-2 text-sm">
      <header className="flex items-baseline gap-2">
        <span className="font-mono text-xs tracking-widest">
          {t("magi.title")}
        </span>
        <span className="text-xs text-muted">{t("magi.question")}</span>
      </header>
      <ul className="flex flex-col gap-2.5">
        {motions.map((council, index) => (
          <li key={scenarios[index]?.label} className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 truncate">
                {scenarios[index]?.label}
              </span>
              <Tally council={council} />
            </div>
            <ul className="flex flex-col gap-1 border-l border-separator pl-2.5">
              {council.votes.map((vote) => (
                <li
                  key={vote.unit}
                  className="grid grid-cols-[7.5rem_auto_minmax(0,1fr)] items-baseline gap-x-2">
                  <UnitName unit={vote.unit} />
                  <VoteMark vote={vote.vote} />
                  <p className="text-xs text-muted">{vote.reason}</p>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
