import type { RevenueTrend, StatementMetrics } from "@solyx/core/fundamentals";
import type { SymbolRef } from "@solyx/core/market";

/** A listing's newest filed figures, each against the periods around it, oldest first. */
export interface FinancialTrends {
  /** Its quarters' income statements. */
  quarters: StatementMetrics[];
  /** Its months of revenue, which are unaudited. */
  months: RevenueTrend[];
}

export interface FundamentalsApi {
  /** `null` for a listing whose market no source covers; empty for one that files none, as a fund does. */
  trends(symbol: SymbolRef): Promise<FinancialTrends | null>;
}

export const fundamentalsChannels = {
  trends: "fundamentals:trends",
} as const satisfies Record<keyof FundamentalsApi, string>;
