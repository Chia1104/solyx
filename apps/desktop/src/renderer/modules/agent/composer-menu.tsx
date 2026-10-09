import { ListBox } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { useCommandSkills, useMentionableListings } from "./agent-mentions.ts";
import { ComposerTokenKind } from "./composer-token.ts";
import type { ComposerToken } from "./composer-token.ts";

export interface ComposerSuggestion {
  id: string;
  /** What replaces the token. */
  value: string;
  /** What the token's query is matched against, lower-cased. */
  keywords: string;
  label: string;
  detail?: string;
  tag?: string;
}

/** Whether a suggestion's keywords answer what was typed after the trigger. */
export const suggests = (keywords: string, query: string) =>
  keywords.includes(query.toLowerCase());

/** Everything the token under the caret could become, before what was typed narrows it. */
export function useComposerSuggestions(
  token: ComposerToken | null,
  focus: SymbolRef | null
): ComposerSuggestion[] {
  const { t } = useTranslation();
  const listings = useMentionableListings(focus);
  const skills = useCommandSkills();

  if (token?.kind === ComposerTokenKind.Skill) {
    return skills.map((skill) => ({
      id: skill.name,
      value: `/${skill.name}`,
      keywords: skill.name,
      label: `/${skill.name}`,
      detail: skill.description,
    }));
  }

  return listings.map(({ symbol, origin, name }) => ({
    id: symbolKey(symbol),
    value: `@${symbol.symbol}`,
    keywords: [symbol.symbol, name].join(" ").toLowerCase(),
    label: symbol.symbol,
    detail: name,
    tag: `${t(`market.${symbol.market}`)} · ${t(`agent.composer-menu.${origin}`)}`,
  }));
}

/**
 * Suggestions for the token under the caret, above the composer. The input keeps focus, and the
 * Autocomplete around both filters the list, so its virtual focus never rests on an option
 * filtered away.
 */
export function ComposerMenu({
  label,
  suggestions,
  onPick,
}: {
  label: string;
  suggestions: ComposerSuggestion[];
  onPick: (suggestion: ComposerSuggestion) => void;
}) {
  return (
    <div className="absolute inset-x-2 bottom-full z-10 mb-1 overflow-hidden rounded-sm border border-border bg-overlay shadow-md">
      <ListBox
        aria-label={label}
        items={suggestions}
        className="max-h-72 overflow-y-auto p-1"
        onAction={(key) => {
          const picked = suggestions.find((each) => each.id === key);

          if (picked) onPick(picked);
        }}>
        {(suggestion) => (
          <ListBox.Item
            id={suggestion.id}
            textValue={suggestion.keywords}
            className="flex items-center gap-2 text-sm data-focused:bg-default">
            <span className="shrink-0 font-medium tabular-nums">
              {suggestion.label}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted">
              {suggestion.detail}
            </span>
            {suggestion.tag ? (
              <span className="shrink-0 text-xs text-muted">
                {suggestion.tag}
              </span>
            ) : null}
          </ListBox.Item>
        )}
      </ListBox>
    </div>
  );
}
