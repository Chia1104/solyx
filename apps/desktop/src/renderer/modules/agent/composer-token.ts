/** What the token under the caret asks the composer to suggest. */
export const ComposerTokenKind = {
  /** `@` where no letter or digit precedes it: a listing. */
  Listing: "listing",
  /** `/` opening the message: a skill. */
  Skill: "skill",
} as const;

export type ComposerTokenKind =
  (typeof ComposerTokenKind)[keyof typeof ComposerTokenKind];

export interface ComposerToken {
  kind: ComposerTokenKind;
  /** Where the trigger sits. */
  start: number;
  /** Where the token ends, which may be past the caret. */
  end: number;
  /** What was typed between the trigger and the caret. */
  query: string;
}

// They open where `messageParts` from `@solyx/agent/wire` reads a skill or a listing, full-width
// forms included. A listing's query may be its name, so it runs to the next space.
const SKILL_BEFORE_CARET = /^\s*[/／]([a-z0-9-]*)$/i;

const LISTING_BEFORE_CARET = /(?<![0-9A-Za-z])[@＠]([^\s@＠]*)$/;

const TOKEN_REST = /^\S*/;

/** The token the caret is in, if it asks for a suggestion. */
export function tokenAt(text: string, caret: number): ComposerToken | null {
  const before = text.slice(0, caret);
  const skill = SKILL_BEFORE_CARET.exec(before);
  const match = skill ?? LISTING_BEFORE_CARET.exec(before);

  if (!match) return null;

  const query = match[1];

  return {
    kind: skill ? ComposerTokenKind.Skill : ComposerTokenKind.Listing,
    start: caret - query.length - 1,
    end: caret + (TOKEN_REST.exec(text.slice(caret))?.[0].length ?? 0),
    query,
  };
}

/** `text` with `token` replaced by `value` and a space, and where the caret goes after it. */
export function replaceToken(
  text: string,
  token: ComposerToken,
  value: string
) {
  const rest = text.slice(token.end).replace(/^ /, "");
  const inserted = `${value} `;

  return {
    text: text.slice(0, token.start) + inserted + rest,
    caret: token.start + inserted.length,
  };
}
