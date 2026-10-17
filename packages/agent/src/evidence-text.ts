import type { EvidenceReading } from "@solyx/core/forecast";
import { Stance } from "@solyx/core/sentiment";

import { percent } from "./figures.ts";

/** How a decisions model read the facts a forecast rests on, as the shares of good, mixed and bad news it gave them. */
export function evidenceText({
  model,
  facts,
  stance,
}: EvidenceReading): string {
  const good = stance[Stance.Positive] + stance[Stance.LeanPositive];
  const bad = stance[Stance.Negative] + stance[Stance.LeanNegative];

  return `A decisions model (${model}) read ${facts === 1 ? "the one fact" : `each of the ${facts} facts`} alone for how it bears on the share price: good news ${percent(good, 0)}, mixed or neutral ${percent(stance[Stance.Neutral], 0)}, bad news ${percent(bad, 0)}. It reads words and saw no price.`;
}
