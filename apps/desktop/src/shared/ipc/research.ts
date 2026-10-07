import type { SymbolRef } from "@solyx/core/market";
import type { Coverage } from "@solyx/core/research";

export interface ResearchApi {
  /** A listing's report and forecasts; reading settles the forecasts whose horizon has closed. */
  coverage(symbol: SymbolRef): Promise<Coverage>;
}

/** Pushes from the main process; each subscription returns a function that stops listening. */
export interface ResearchEvents {
  /** A report was revised, a forecast made or settled, or all of it cleared. */
  onChanged(listener: () => void): () => void;
}

export const researchChannels = {
  coverage: "research:coverage",
} as const satisfies Record<keyof ResearchApi, string>;

export const researchEvents = {
  onChanged: "research:changed",
} as const satisfies Record<keyof ResearchEvents, string>;
