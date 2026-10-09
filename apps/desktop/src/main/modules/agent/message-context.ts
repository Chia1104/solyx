import { uniqBy } from "es-toolkit";

import type { ContextListing } from "@solyx/agent/prompt";
import { messageTokens } from "@solyx/agent/wire";
import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

export interface MessageContextSources {
  /** The listing on screen, named as the renderer shows it. */
  focus: ContextListing | null;
  watchlist(): readonly SymbolRef[];
  /** What the account holds, asked only for a code the screen and the watchlist miss, since a live broker answers over the network. */
  holdings(): Promise<readonly SymbolRef[]>;
  /** The exchange's name for a listing, when its source knows it. */
  name(symbol: SymbolRef): Promise<string | undefined>;
  /** The skills the user may ask for with `/name`. */
  commands(): Promise<readonly string[]>;
}

/**
 * The listings a message names with `@` and the skill its leading `/name` asks for, as far as
 * the app knows them. A token naming neither stays the user's text, and a source that fails
 * leaves out what only it knew rather than failing the message.
 */
export async function messageContext(
  text: string,
  sources: MessageContextSources
) {
  const { skill, codes } = messageTokens(text);

  const near = [
    ...(sources.focus ? [sources.focus.symbol] : []),
    ...sources.watchlist(),
  ];

  const named = (listings: readonly SymbolRef[], code: string) =>
    listings.find((listing) => listing.symbol.toUpperCase() === code);

  const held = codes.some((code) => !named(near, code))
    ? await sources.holdings().catch(() => [])
    : [];

  const symbols = uniqBy(
    codes.flatMap((code) => named([...near, ...held], code) ?? []),
    symbolKey
  );

  const focusKey = sources.focus && symbolKey(sources.focus.symbol);

  const mentions = await Promise.all(
    symbols.map(async (symbol): Promise<ContextListing> => {
      const name =
        symbolKey(symbol) === focusKey
          ? sources.focus?.name
          : await sources.name(symbol).catch(() => undefined);

      return name ? { symbol, name } : { symbol };
    })
  );

  const asked =
    skill !== undefined && (await sources.commands()).includes(skill)
      ? skill
      : undefined;

  return { mentions, skill: asked };
}
