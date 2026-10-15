import type { RevenueTrend, StatementMetrics } from "@solyx/core/fundamentals";

/** A listing's newest filed figures, each against the periods around it, oldest first. */
export interface FinancialTrends {
  /** Its quarters' income statements. */
  quarters: StatementMetrics[];
  /** Its months of revenue, which are unaudited. */
  months: RevenueTrend[];
}
