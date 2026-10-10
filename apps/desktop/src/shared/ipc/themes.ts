import type { ThemeDraft, ThemeWatch } from "@solyx/core/theme";

export interface ThemesApi {
  /** Every theme with what watching it has found, the one with the newest development first. */
  list(): Promise<ThemeWatch[]>;
  create(draft: ThemeDraft): Promise<void>;
  /** Writes the theme again; what was found for it stays. */
  update(id: string, draft: ThemeDraft): Promise<void>;
  /** Removes the theme with everything found and read for it. */
  remove(id: string): Promise<void>;
  /** Searches for the theme now, whenever it was last searched. */
  check(id: string): Promise<void>;
}

/** Pushes from the main process; each subscription returns a function that stops listening. */
export interface ThemesEvents {
  /** A theme was written or removed, or a search found or read something for one. */
  onChanged(listener: () => void): () => void;
}

export const themesChannels = {
  list: "themes:list",
  create: "themes:create",
  update: "themes:update",
  remove: "themes:remove",
  check: "themes:check",
} as const satisfies Record<keyof ThemesApi, string>;

export const themesEvents = {
  onChanged: "themes:changed",
} as const satisfies Record<keyof ThemesEvents, string>;
