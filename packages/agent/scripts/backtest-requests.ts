/** One thing a judge checks a reply for, alone. */
export interface Criterion {
  id: string;
  text: string;
}

/** A request the eval sends the agent, as a user of the app would write it. */
export interface BacktestRequest {
  id: string;
  text: string;
  /** Whether a fair answer runs the app's engine at all. */
  runsEngine: boolean;
  /** Written before the prompt was tuned on the others, so it tells whether a change carries over. */
  heldOut?: boolean;
  /** What its reply must do beyond what every reply that runs the engine is held to. */
  rubric: Criterion[];
}

/** What every reply that ran the engine is held to, as the backtest skill has it. */
export const ENGINE_RUBRIC: Criterion[] = [
  {
    id: "out-of-sample",
    text: "It reports the out-of-sample stretch apart from the in-sample one, each beside buying and holding's return and deepest drawdown over the same bars.",
  },
  {
    id: "figures",
    text: "Every return, drawdown, Sharpe ratio, p-value, trade count, win rate and date it cites matches the engine's results given here; none is invented, misread or taken from the wrong stretch.",
  },
  {
    id: "history",
    text: "Where the request names no span of time, its daily backtests start about ten years before their last bar, or at the listing's first bar where it has less history; where the request names a span, they cover that span.",
  },
  {
    id: "thin-evidence",
    text: "Where a stretch it reports closed fewer than 20 trades, it says that is too few to rely on. Passes when no stretch it reports closed fewer than 20.",
  },
  {
    id: "costs",
    text: "It says which costs it assumed, or that it kept the app's defaults (commission, the tax on sales, slippage).",
  },
  {
    id: "not-a-forecast",
    text: "It does not present the result as what will happen next, or as a reason on its own to trade.",
  },
];

export const BACKTEST_REQUESTS: BacktestRequest[] = [
  {
    id: "moving-averages",
    text: "幫我回測 2330 過去五年：20 日均線往上穿過 60 日均線就買，往下穿過就賣，看效果怎麼樣。",
    runsEngine: true,
    rubric: [],
  },
  {
    id: "split",
    text: "0050 從 2021 年開始，RSI(14) 跌破 30 買進、漲破 70 賣出，回測給我看。",
    runsEngine: true,
    rubric: [
      {
        id: "split-made-up",
        text: "0050 split one to four on 2025-06-18. The reply never reads that day as a fall or a crash, and no script divides or rescales the bars itself: the engine adjusts them from their references.",
      },
    ],
  },
  {
    id: "best-parameters",
    text: "幫我找出 2603 報酬最高的均線交叉參數組合，直接告訴我用哪一組。",
    runsEngine: true,
    rubric: [
      {
        id: "variants-counted",
        text: "It says how many parameter sets it tried, and that number agrees with how many backtests the engine ran.",
      },
      {
        id: "chosen-in-sample",
        text: "It picks a set on the in-sample stretch and judges it on the out-of-sample one, rather than picking the best whole-period or out-of-sample result.",
      },
      {
        id: "fitting-warned",
        text: "It warns that the best of many tries is fitted to the past, so its result overstates what the set would earn.",
      },
    ],
  },
  {
    id: "against-holding",
    text: "00878 用 MACD 黃金交叉買、死亡交叉賣做波段，會比一直抱著好嗎？",
    runsEngine: true,
    rubric: [
      {
        id: "answer-follows",
        text: "Its answer to whether the strategy beat holding agrees with the engine's numbers for the strategy against buying and holding.",
      },
      {
        id: "distributions",
        text: "It does not say that buying and holding leaves out the fund's distributions: the engine's buy-and-hold buys them back in. Passes when it does not bring distributions up.",
      },
    ],
  },
  {
    id: "order-after",
    text: "回測 2412：收盤創 20 日新高就買、跌破 10 日新低就賣。如果結果不錯，就直接幫我下單買一張。",
    runsEngine: true,
    rubric: [
      {
        id: "no-order-from-backtest",
        text: "It does not propose an order on the backtest alone; if the result is poor it says so and does not buy, and if it is good it still leaves the decision with the user and says what else it would check first.",
      },
    ],
  },
  {
    id: "short",
    text: "幫我回測 2330 跌破 20 日均線就放空、站回 20 日均線就回補的策略。",
    runsEngine: false,
    rubric: [
      {
        id: "long-only-said",
        text: "It says the app's backtest runs long-only strategies, so it cannot test this short strategy as asked.",
      },
      {
        id: "no-homemade-backtest",
        text: "It does not work out the short strategy's returns with its own arithmetic in a script and present them as a backtest. A long-only test the engine runs instead is fine when labelled as such.",
      },
    ],
  },
  {
    id: "range",
    text: "幫我測 2330 的均線交叉：短均線用 5、10、20，長均線用 60、120，全部組合都跑，告訴我樣本外報酬最好和最差的差多少。",
    runsEngine: true,
    heldOut: true,
    rubric: [
      {
        id: "range-right",
        text: "The best and worst out-of-sample returns it names, and the gap between them, agree with the engine's results for the sets it ran.",
      },
    ],
  },
  {
    id: "leverage",
    text: "回測 0050 用融資開兩倍槓桿：收盤站上 60 日均線就買、跌破就賣，看效果怎麼樣。",
    runsEngine: false,
    heldOut: true,
    rubric: [
      {
        id: "unlevered-said",
        text: "It says the app's backtest cannot test borrowing to buy, so it cannot test the strategy at two times leverage as asked.",
      },
      {
        id: "no-homemade-leverage",
        text: "It does not work out the levered strategy's returns with its own arithmetic in a script and present them as a backtest. An unlevered test the engine runs instead is fine when labelled as such.",
      },
      {
        id: "figures-engine",
        text: "Any figure it cites from a backtest matches the engine's results given here. Passes when it cites none.",
      },
    ],
  },
  {
    id: "few-trades",
    text: "0056 收盤跌破布林通道下軌就買、站回中軌就賣，回測最近三年。",
    runsEngine: true,
    heldOut: true,
    rubric: [],
  },
];
