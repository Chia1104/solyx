import * as z from "zod";

/** Who decides the agent's forecasts and order proposals before they are kept. */
export const DecisionMode = {
  /** The agent alone. */
  Single: "single",
  /** Three units vote on each as a motion, and two votes carry it. */
  Magi: "magi",
} as const;

export type DecisionMode = (typeof DecisionMode)[keyof typeof DecisionMode];

export const decisionModeSchema = z.enum(DecisionMode);

/** The MAGI's three units, each judging a motion as one side of a single mind. */
export const MagiUnit = {
  /** The scientist: what the data and the evidence show. */
  Melchior: "melchior",
  /** The mother: what protects the capital. */
  Balthasar: "balthasar",
  /** The woman: what desire and the crowd's mood make of it. */
  Casper: "casper",
} as const;

export type MagiUnit = (typeof MagiUnit)[keyof typeof MagiUnit];

export const MagiVote = {
  Approve: "approve",
  Reject: "reject",
} as const;

export type MagiVote = (typeof MagiVote)[keyof typeof MagiVote];

export const unitVoteSchema = z.object({
  unit: z.enum(MagiUnit),
  /** `null` when the unit gave no vote that could be read. */
  vote: z.enum(MagiVote).nullable(),
  /** The unit's own words for its vote, or what kept it from voting. */
  reason: z.string(),
  /** The model that answered as the unit. */
  model: z.string(),
});

export type UnitVote = z.infer<typeof unitVoteSchema>;

/** A motion's votes and whether they carried it. */
export const councilSchema = z.object({
  votes: z.array(unitVoteSchema),
  carried: z.boolean(),
});

export type Council = z.infer<typeof councilSchema>;

// Two of the three units; a unit that gave no vote counts for neither side.
const MAJORITY = 2;

export function resolveCouncil(votes: UnitVote[]): Council {
  return {
    votes,
    carried:
      votes.filter(({ vote }) => vote === MagiVote.Approve).length >= MAJORITY,
  };
}

/** How a vote came out. */
export const CouncilOutcome = {
  Carried: "carried",
  Rejected: "rejected",
  /** Units that gave no vote could have carried it, so it was neither carried nor turned down. */
  Undecided: "undecided",
} as const;

export type CouncilOutcome =
  (typeof CouncilOutcome)[keyof typeof CouncilOutcome];

export function councilOutcome({ votes, carried }: Council): CouncilOutcome {
  if (carried) return CouncilOutcome.Carried;

  const open = votes.filter(({ vote }) => vote !== MagiVote.Reject).length;

  return open >= MAJORITY ? CouncilOutcome.Undecided : CouncilOutcome.Rejected;
}
