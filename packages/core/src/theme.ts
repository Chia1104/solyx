import * as z from "zod";

import { symbolRefSchema } from "./market.ts";
import { storyText } from "./news.ts";
import type { NewsItem } from "./news.ts";
import { CLAIM_SUPPORT_LINE, proseSchema } from "./report.ts";
import type { ClaimAuditor, ClaimSupport } from "./report.ts";

export const THEME_TITLE_LENGTH = 80;

export const THEME_THESIS_LENGTH = 600;

export const THEME_QUERY_LENGTH = 80;

export const THEME_SIGNPOST_LENGTH = 300;

export const THEME_EXPOSURE_LENGTH = 200;

export const THEME_QUERIES = 4;

export const THEME_SIGNPOSTS = 6;

export const THEME_LISTINGS = 12;

/** A listing a theme could reach, and how. */
export const themeListingSchema = z.object({
  symbol: symbolRefSchema,
  /** How the theme would reach it, in a sentence. */
  exposure: proseSchema(THEME_EXPOSURE_LENGTH),
});

/** A standing topic as it is written. */
export const themeDraftSchema = z.object({
  title: proseSchema(THEME_TITLE_LENGTH),
  /** Why it may come to matter to what the user holds, in a few sentences. */
  thesis: proseSchema(THEME_THESIS_LENGTH),
  /** What a news search asks for, each a few words in a language its news is written in. */
  queries: z.array(proseSchema(THEME_QUERY_LENGTH)).min(1).max(THEME_QUERIES),
  /** What would show it coming closer, each stated as something that happens. */
  signposts: z
    .array(proseSchema(THEME_SIGNPOST_LENGTH))
    .min(1)
    .max(THEME_SIGNPOSTS),
  listings: z.array(themeListingSchema).max(THEME_LISTINGS),
});

export type ThemeDraft = z.infer<typeof themeDraftSchema>;

/**
 * Something in the world the user has the app watch because it could reach what they hold over
 * quarters, though it moves no price now: an outbreak, a conflict, a rule in the making.
 */
export interface Theme extends ThemeDraft {
  id: string;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms it was last written. */
  updatedAt: number;
}

/** A news item one of a theme's searches found. */
export interface ThemeItem extends Pick<
  NewsItem,
  "id" | "title" | "snippet" | "url" | "site" | "published"
> {
  /** Epoch ms of the first search that found it for the theme. */
  foundAt: number;
}

/** How far an item states that a signpost happened, as a decisions model read the two. */
export interface SignpostReading {
  signpost: string;
  /** The item's id among the theme's. */
  itemId: string;
  support: ClaimSupport;
  /** Epoch ms. */
  checkedAt: number;
}

/** Where themes and what was found for them persist. */
export interface ThemeStore {
  /** Oldest first. */
  list(): Theme[];
  get(id: string): Theme | undefined;
  /** Keeps a new theme, or replaces the one of its id. */
  save(theme: Theme): void;
  /** Removes the theme with everything found and read for it. */
  remove(id: string): void;
  /** Up to `limit` of the items found for the theme, the last found first. */
  items(themeId: string, limit: number): ThemeItem[];
  /** Keeps the items the theme does not hold yet. */
  addItems(themeId: string, items: readonly ThemeItem[]): void;
  readings(themeId: string): SignpostReading[];
  addReading(themeId: string, reading: SignpostReading): void;
  /** Epoch ms its searches last ran; `null` before the first. */
  collectedAt(themeId: string): number | null;
  markCollected(themeId: string, at: number): void;
}

/** An item a decisions model read as stating that one of a theme's signposts happened. */
export interface Development {
  signpost: string;
  item: ThemeItem;
  support: ClaimSupport;
  /** Epoch ms the item was read against the signpost. */
  checkedAt: number;
}

/** A theme with what watching it has found. */
export interface ThemeWatch {
  theme: Theme;
  /** Newest first, each a lead to read rather than a fact. */
  developments: Development[];
  /** The items its searches found last, the last found first. */
  latest: ThemeItem[];
  /** Epoch ms its searches last ran; `null` before the first. */
  collectedAt: number | null;
  /** Epoch ms of its newest development, or of when it was last written while it has none. */
  quietSince: number;
}

// The items shown for a theme, and read against its signposts: what a few days of searches find.
const WATCHED_ITEMS = 20;

export interface ThemeDeskOptions {
  store: ThemeStore;
  /** Reads each item against each signpost; none until the user sets up a decisions model. */
  auditor?: () => Promise<ClaimAuditor | undefined>;
  /** Called after a theme, or what is found or read for one, changes. */
  onChange?: () => void;
  now?: () => number;
  createId?: () => string;
}

/** When an item was published, or found where its source gave no time. */
const datedAt = ({ published, foundAt }: ThemeItem) =>
  published?.at.getTime() ?? foundAt;

/**
 * The user's themes and what watching them has found. A theme stays quiet until an item reads as
 * stating one of its signposts, so its age counts from its last development, not from the news.
 */
export class ThemeDesk {
  readonly #options: ThemeDeskOptions;

  constructor(options: ThemeDeskOptions) {
    this.#options = options;
  }

  /** Every theme with its developments, the one with the newest first. */
  list(): ThemeWatch[] {
    const { store } = this.#options;

    return store
      .list()
      .map((theme) => {
        const latest = store.items(theme.id, WATCHED_ITEMS);
        const items = new Map(latest.map((item) => [item.id, item]));

        const developments = store
          .readings(theme.id)
          .flatMap(
            ({ signpost, itemId, support, checkedAt }): Development[] => {
              const item = items.get(itemId);

              // A signpost rewritten since is no longer the theme's, and an item past the newest is no longer shown.
              return item &&
                theme.signposts.includes(signpost) &&
                support.supported >= CLAIM_SUPPORT_LINE
                ? [{ signpost, item, support, checkedAt }]
                : [];
            }
          )
          .toSorted((a, b) => datedAt(b.item) - datedAt(a.item));

        return {
          theme,
          developments,
          latest,
          collectedAt: store.collectedAt(theme.id),
          quietSince: developments[0]
            ? datedAt(developments[0].item)
            : theme.updatedAt,
        };
      })
      .toSorted(
        (a, b) =>
          Number(b.developments.length > 0) -
            Number(a.developments.length > 0) || b.quietSince - a.quietSince
      );
  }

  /**
   * Keeps the theme under `id`, a new one when no theme has it, or writes the one that has it
   * again; its items and readings stay.
   */
  save(draft: ThemeDraft, id?: string): Theme {
    const {
      store,
      now = Date.now,
      createId = () => crypto.randomUUID(),
    } = this.#options;

    const at = now();
    const kept = id === undefined ? undefined : store.get(id);

    const theme: Theme = {
      ...draft,
      id: id ?? createId(),
      createdAt: kept?.createdAt ?? at,
      updatedAt: at,
    };

    store.save(theme);
    this.#options.onChange?.();

    return theme;
  }

  remove(id: string): void {
    this.#options.store.remove(id);
    this.#options.onChange?.();
  }

  /**
   * Keeps what a search found for the theme, then reads each of its newest items against each
   * signpost it has not been read against: once per signpost and item, so an item found before a
   * decisions model was set up, or before a signpost was written, is read then. An item the model
   * could not read is read again with the next search.
   */
  async take(themeId: string, found: readonly ThemeItem[]): Promise<void> {
    const { store, now = Date.now } = this.#options;
    const theme = store.get(themeId);

    if (!theme) return;

    store.addItems(themeId, found);
    store.markCollected(themeId, now());

    const auditor = await this.#options.auditor?.();

    if (auditor) {
      const read = new Set(
        store
          .readings(themeId)
          .map(({ signpost, itemId }) => JSON.stringify([signpost, itemId]))
      );

      for (const item of store.items(themeId, WATCHED_ITEMS)) {
        for (const signpost of theme.signposts) {
          if (read.has(JSON.stringify([signpost, item.id]))) continue;

          const support = await auditor
            .audit({
              text: signpost,
              source: (item.url ?? item.site).slice(0, 300),
              quote: storyText(item),
            })
            .catch(() => null);

          if (support) {
            store.addReading(themeId, {
              signpost,
              itemId: item.id,
              support,
              checkedAt: now(),
            });
          }
        }
      }
    }

    this.#options.onChange?.();
  }
}
