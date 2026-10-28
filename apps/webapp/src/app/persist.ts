import type * as z from "zod";
import type { PersistOptions } from "zustand/middleware";

/** The local storage key the renderer saves `name` under. */
const storageKey = (name: string) => `solyx.${name}`;

/**
 * Saves a zustand store in local storage under `storageKey(name)`, only what `partialize` picks
 * where it is given. Local storage outlives app versions, so saved state that no longer parses
 * with `schema` is dropped for the defaults.
 */
export function persistOptions<State, Saved = State>(
  name: string,
  schema: z.ZodType<Partial<State>>,
  partialize?: (state: State) => Saved
): PersistOptions<State, Saved> {
  const options: PersistOptions<State, Saved> = {
    name: storageKey(name),
    version: 1,
    merge: (persisted, current) => ({
      ...current,
      ...schema.safeParse(persisted).data,
    }),
  };

  // zustand spreads these over its defaults, so an absent `partialize` must not be set at all.
  if (partialize) options.partialize = partialize;

  return options;
}
