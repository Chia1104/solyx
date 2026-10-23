import { takeRight } from "es-toolkit";

import type { FinancialTrends } from "@solyx/api/fundamentals";
import { revenueTrend, statementMetrics } from "@solyx/core/fundamentals";
import type { Fundamentals } from "@solyx/core/fundamentals";
import type { SymbolRef } from "@solyx/core/market";

// Two years of quarters and one of months, so each newest period shows beside the year before it.
const QUARTERS = 8;

const MONTHS = 12;

/**
 * What a window draws of a listing's filings, worked out as the agent's `get_fundamentals` works
 * them out, so the two agree. Growth is measured over everything the module keeps before the
 * newest periods are taken, so the oldest one shown still has its year before.
 */
export async function financialTrends(
  fundamentals: Pick<Fundamentals, "source" | "statements" | "monthlyRevenue">,
  symbol: SymbolRef
): Promise<FinancialTrends | null> {
  if (fundamentals.source(symbol.market) === undefined) return null;

  const [statements, monthly] = await Promise.all([
    fundamentals.statements(symbol),
    fundamentals.monthlyRevenue(symbol),
  ]);

  return {
    quarters: takeRight(statementMetrics(statements), QUARTERS),
    months: takeRight(revenueTrend(monthly), MONTHS),
  };
}
