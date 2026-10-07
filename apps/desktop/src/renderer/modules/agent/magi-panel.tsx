import { cn } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { MagiUnit, MagiVote, councilOutcome } from "@solyx/core/council";
import type { Council, UnitVote } from "@solyx/core/council";

// The units keep their own names in every language.
const UNIT_NAME: Record<MagiUnit, string> = {
  [MagiUnit.Melchior]: "MELCHIOR·1",
  [MagiUnit.Balthasar]: "BALTHASAR·2",
  [MagiUnit.Casper]: "CASPER·3",
};

function Unit({ vote }: { vote: UnitVote }) {
  const { t } = useTranslation();
  const approved = vote.vote === MagiVote.Approve;

  return (
    <li
      className={cn(
        "flex flex-col gap-1 border border-separator px-2.5 py-2",
        approved && "border-foreground",
        vote.vote === null && "border-dashed"
      )}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[0.6875rem] tracking-wider">
          {UNIT_NAME[vote.unit]}
        </span>
        <span className="text-xs text-muted">
          {t(`magi.personas.${vote.unit}`)}
        </span>
        {/* Ink for a vote in favour and hatching for one against, since red and green belong to prices. */}
        <span
          className={cn(
            "ml-auto shrink-0 px-1.5 py-0.5 text-xs font-medium",
            approved && "bg-foreground text-background",
            vote.vote === MagiVote.Reject && "hatch",
            vote.vote === null && "text-muted"
          )}>
          {t(`magi.votes.${vote.vote ?? "abstained"}`)}
        </span>
      </div>
      <p className="text-xs text-muted">{vote.reason}</p>
    </li>
  );
}

/** A motion's three votes with each unit's reason, under how the vote came out. */
export function MagiPanel({ council }: { council: Council }) {
  const { t } = useTranslation();

  const count = (cast: MagiVote) =>
    council.votes.filter(({ vote }) => vote === cast).length;

  return (
    <section
      aria-label={t("magi.title")}
      className="flex flex-col gap-1.5 text-sm">
      <header className="flex items-baseline gap-2">
        <span className="font-mono text-xs tracking-widest">
          {t("magi.title")}
        </span>
        <span className="font-medium">
          {t(`magi.${councilOutcome(council)}`)}
        </span>
        <span className="text-xs text-muted tabular-nums">
          {t("magi.tally", {
            approved: count(MagiVote.Approve),
            rejected: count(MagiVote.Reject),
          })}
        </span>
      </header>
      <ul className="flex flex-col gap-1.5">
        {council.votes.map((vote) => (
          <Unit key={vote.unit} vote={vote} />
        ))}
      </ul>
    </section>
  );
}
