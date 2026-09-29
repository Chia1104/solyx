import { isEqual } from "es-toolkit";
import type { Time } from "lightweight-charts";

/**
 * The items `series.update` can apply when `next` differs from `previous` only in its last item,
 * or by one appended item, as a forming live bar does; `undefined` when the series must be set again.
 */
export function liveTail<Item extends { time: Time }>(
  previous: readonly Item[],
  next: readonly Item[]
): Item[] | undefined {
  const last = previous.length - 1;

  if (
    last < 0 ||
    next.length < previous.length ||
    next.length > previous.length + 1 ||
    !isEqual(next[last].time, previous[last].time)
  ) {
    return undefined;
  }

  for (let i = 0; i < last; i++) {
    if (!isEqual(next[i], previous[i])) return undefined;
  }

  return next.slice(last);
}
