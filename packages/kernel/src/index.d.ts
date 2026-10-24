/**
 * Runs the strategy: each rule read at a bar's close and acted on at the next bar's open. A buy
 * spends what the account holds on whole shares; a sale sells them all.
 */
export declare function backtest(columns: BacktestColumns): BacktestRun

/** A long-only strategy over a listing's bars, oldest first, as `@solyx/core/backtest` prepares it. */
export interface BacktestColumns {
  /** Closes as traded, which mark a holding. */
  close: Float64Array
  /** Closes adjusted for splits and what went ex, which stops and buying and holding read. */
  adjustedClose: Float64Array
  /** What a bar's prices as traded are divided by to read adjusted. */
  factor: Float64Array
  /** What a holding's shares are multiplied by at a bar: the close before over its session's reference, else 1. */
  carry: Float64Array
  /** What a buy fills at on the bar's open, its slippage included. */
  buyPrice: Float64Array
  sellPrice: Float64Array
  /** 1 where the bar is locked at its upper limit and fills no buy. */
  buyLocked: Uint8Array
  /** 1 where the bar is locked at its lower limit and fills no sale. */
  sellLocked: Uint8Array
  /** The epoch day of each bar's session. */
  day: Int32Array
  /** Each series the rules read, NaN where it has nothing yet. */
  lines: Array<Float64Array>
  entry: KernelCondition
  exit: KernelCondition
  /** Sells once an adjusted close falls this fraction below the price paid. */
  stopLoss?: number
  /** Sells once an adjusted close rises this fraction above the price paid. */
  takeProfit?: number
  capital: number
  commissionRate: number
  minCommission: number
  sellTaxRate: number
  /** The first bar of the out-of-sample stretch; none without a split. */
  splitAt?: number
}

export interface BacktestRun {
  /** The account's value at each bar's close. */
  equity: Float64Array
  trades: KernelTrades
  all: KernelMetrics
  inSample: KernelMetrics | null
  outOfSample: KernelMetrics | null
}

/** A rule as `@solyx/core/backtest` declares it, each series named by its place in the lines. */
export interface KernelCondition {
  all?: Array<KernelCondition>
  any?: Array<KernelCondition>
  above?: Array<number>
  below?: Array<number>
  crossesAbove?: Array<number>
  crossesBelow?: Array<number>
}

/** How a stretch of the run went, against the account's value at the close before it. */
export interface KernelMetrics {
  totalReturn: number
  annualReturn: number | null
  maxDrawdown: number
  /** Trades closed within the stretch. */
  trades: number
  winRate: number | null
  payoffRatio: number | null
  exposure: number
  buyAndHold: number
  buyAndHoldDrawdown: number
}

/** Every trade of the run, oldest first, one column per figure. */
export interface KernelTrades {
  /** The bar whose fill bought. */
  entry: Int32Array
  /** The bar whose fill sold, -1 for a position still held at the last bar. */
  exit: Int32Array
  entryPrice: Float64Array
  /** The last close for a position still held. */
  exitPrice: Float64Array
  /** The shares bought. */
  shares: Float64Array
  /** What it gained after every cost, marked at the last close while held. */
  profit: Float64Array
  /** That gain as a fraction of what the shares and the commission cost. */
  return: Float64Array
}
