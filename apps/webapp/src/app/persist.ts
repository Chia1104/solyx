import type * as z from "zod";
import type { PersistOptions } from "zustand/middleware";

/** The local storage key the renderer saves `name` under. */
export const storageKey = (name: string) => `solyx.${name}`;

/**
 * Saves a zustand store in local storage under `storageKey(name)`. Local storage outlives app
 * versions, so saved state that no longer parses with `schema` is dropped for the defaults.
 */
export function persistOptions<State>(
  name: string,
  schema: z.ZodType<Partial<State>>
): PersistOptions<State> {
  return {
    name: storageKey(name),
    version: 1,
    merge: (persisted, current) => ({
      ...current,
      ...schema.safeParse(persisted).data,
    }),
  };
}
