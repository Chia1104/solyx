import type { ReactNode } from "react";

import { MessagePartKind, messageParts } from "@solyx/agent/wire";

import { useCommandSkills, useMentionableListings } from "./agent-mentions.ts";

function Token({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-xs border border-border bg-surface px-1 whitespace-nowrap">
      {children}
    </span>
  );
}

/**
 * What the user wrote, with each skill and listing it names marked where the app knows it now;
 * the context the agent got was resolved when the message was sent.
 */
export function MessageText({ text }: { text: string }) {
  const listings = useMentionableListings(null);
  const skills = useCommandSkills();

  return messageParts(text).map((part, index) => {
    // The parts never change order, so their places are their keys.
    const key = index;

    if (
      part.kind === MessagePartKind.Skill &&
      skills.some((skill) => skill.name === part.name)
    ) {
      return (
        <Token key={key}>
          <span className="font-mono text-xs">{part.text}</span>
        </Token>
      );
    }

    if (part.kind === MessagePartKind.Listing) {
      const listing = listings.find(
        (each) => each.symbol.symbol.toUpperCase() === part.code
      );

      if (listing) {
        return (
          <Token key={key}>
            <span className="font-medium">{part.text}</span>
            {listing.name ? (
              <span className="ml-1 text-muted">{listing.name}</span>
            ) : null}
          </Token>
        );
      }
    }

    return part.text;
  });
}
