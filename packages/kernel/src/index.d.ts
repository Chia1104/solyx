/** Runs one strategy over every bar, holding nothing at the first. */
export declare function backtest(request: BacktestRequest): BacktestRun

export interface BacktestRequest {
  bars: KernelBars
  strategy: KernelStrategy
  /** The first bar of the out-of-sample stretch; none without a split. */
  splitAt?: number
  /** How many orderings of each stretch's bars its timing is tested against; 0 tests none. */
  permutations: number
}

export interface BacktestRun {
  /** The account's value at each bar's close. */
  equity: Float64Array
  trades: KernelTrades
  stretches: KernelStretches
}

/** A listing's bars, oldest first, and what trading them costs, as `@solyx/core/backtest` prepares them. */
export interface KernelBars {
  /** Opens as traded, which a fill's slippage is counted from. */
  open: Float64Array
  /** Closes as traded, which mark a holding. */
  close: Float64Array
  /**
   * Opens and closes adjusted for splits and what went ex, which stops, buying and holding and
   * the permutation test read.
   */
  adjustedOpen: Float64Array
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
  capital: number
  commissionRate: number
  minCommission: number
  sellTaxRate: number
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

/** How a stretch of a run went, against the account's value at the close before it. */
export interface KernelMetrics {
  totalReturn: number
  /** The return a year at that pace, `null` over a stretch shorter than a month. */
  annualReturn: number | null
  /** The deepest fall of the account's value from a high before it, as a fraction. */
  maxDrawdown: number
  /**
   * The mean of the account's returns from one session's close to the next over their
   * deviation, a year's worth at their pace; `null` over a stretch shorter than a month or
   * that never moved.
   */
  sharpe: number | null
  /**
   * How often the stretch's bars ordered at random did as well as the rules' timing did on
   * them, the orderings held as the run held and charged its costs: below 0.05 the timing beat
   * chance; `null` where the run tested none, or held nothing.
   */
  pValue: number | null
  /** Trades closed within it; one still held is not counted. */
  trades: number
  winRate: number | null
  /** The average gain over the size of the average loss; `null` without both. */
  payoffRatio: number | null
  /** The part of its bars a position was held through. */
  exposure: number
  /**
   * What holding the listing through it would have returned, from the close its return is
   * measured from to its last, before costs, with what went ex bought back in as the rules'
   * prices have it.
   */
  buyAndHold: number
  /**
   * The deepest fall holding it would have taken from a high before it, as a fraction, on the
   * closes `buyAndHold` reads.
   */
  buyAndHoldDrawdown: number
}

/** The cell of a grid whose neighbourhood did best. */
export interface KernelPlateau {
  cell: number
  /** The mean Sharpe ratio of the cell and its neighbours that have one. */
  sharpe: number
  /** Whether it lies on the grid's edge, where the best of the neighbourhood may lie past it. */
  edge: boolean
}

/** The bars a window runs over, from its first to its last. */
export interface KernelSpan {
  first: number
  last: number
}

/** A long-only strategy: when to buy while holding nothing, and when to sell all of it. */
export interface KernelStrategy {
  entry: KernelCondition
  exit: KernelCondition
  /** Sells once an adjusted close falls this fraction below the price paid. */
  stopLoss?: number
  /** Sells once an adjusted close rises this fraction above the price paid. */
  takeProfit?: number
}

/** A run's figures over all its bars, and before and from its split where it has one. */
export interface KernelStretches {
  all: KernelMetrics
  inSample: KernelMetrics | null
  outOfSample: KernelMetrics | null
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

/** One window: the bars it trained on and tested on, and the strategy its training picked. */
export interface KernelWindow {
  trainFirst: number
  trainLast: number
  testFirst: number
  testLast: number
  /** None where no strategy had a Sharpe ratio over the training, and the test then holds nothing. */
  cell: number | null
  /** The picked strategy's own Sharpe ratio over the training, not its neighbourhood's. */
  trainSharpe: number | null
}

/**
 * Runs one strategy over each window on its own, all at once, holding nothing at the close before
 * the window's first bar. Its rules are read from that close, so its first fill may come at the
 * first bar's open, and its figures and holding's are measured from there; a window from the very
 * first bar, which has no close before it, starts at that bar's close.
 */
export declare function rolling(request: RollingRequest): RollingRun

export interface RollingRequest {
  bars: KernelBars
  strategy: KernelStrategy
  windows: Array<KernelSpan>
}

export interface RollingRun {
  /** Each window's figures, in the order they came. */
  windows: Array<KernelMetrics>
}

/** Runs each strategy over every bar on its own, holding nothing at the first, all at once. */
export declare function scan(request: ScanRequest): ScanRun

export interface ScanRequest {
  bars: KernelBars
  strategies: Array<KernelStrategy>
  /** The first bar of the out-of-sample stretch; none without a split. */
  splitAt?: number
  /** How many strategies a row of the grid they make holds, row by row; none where they make none. */
  columns?: number
}

export interface ScanRun {
  /** Each strategy's stretches, in the order they came. */
  cells: Array<KernelStretches>
  /** Picked on the in-sample stretch where there is a split, else on all the bars. */
  plateau: KernelPlateau | null
}

/**
 * Picks a strategy on each window's training, by the grid's plateau where they make one, applies
 * it to the sessions after, and runs those tests as one: a holding carries over from one test to the
 * next, and the next pick's rules decide what it does.
 */
export declare function walkForward(request: WalkForwardRequest): WalkForwardRun

export interface WalkForwardRequest {
  bars: KernelBars
  strategies: Array<KernelStrategy>
  /** How many strategies a row of the grid they make holds, row by row; none where they make none. */
  columns?: number
  /** The sessions each window trains on. */
  train: number
  /** The sessions each window then tests on, which is how far the next window moves on. */
  test: number
  /** How many orderings of the tests' bars their timing is tested against; 0 tests none. */
  permutations: number
}

export interface WalkForwardRun {
  windows: Array<KernelWindow>
  /** The tests' bars run as one, each under its window's pick, holding nothing at the first. */
  outOfSample: KernelMetrics
  /** The account's value at each bar's close from the first test bar on. */
  equity: Float64Array
  /** The out-of-sample Sharpe ratio over the mean of the picks' training ones. */
  efficiency: number | null
}
