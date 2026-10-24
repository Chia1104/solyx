use napi::bindgen_prelude::{Float64Array, Int32Array, Uint8Array};
use napi::{Error, Result, Status};
use napi_derive::napi;

use crate::rule::{KernelCondition, Rule};

const DAYS_A_YEAR: f64 = 365.25;

// A stretch shorter than this has no yearly pace worth naming.
const SHORTEST_ANNUALIZED_DAYS: i32 = 28;

/// A long-only strategy over a listing's bars, oldest first, as `@solyx/core/backtest` prepares it.
#[napi(object)]
pub struct BacktestColumns {
    /// Closes as traded, which mark a holding.
    pub close: Float64Array,
    /// Closes adjusted for splits and what went ex, which stops and buying and holding read.
    pub adjusted_close: Float64Array,
    /// What a bar's prices as traded are divided by to read adjusted.
    pub factor: Float64Array,
    /// What a holding's shares are multiplied by at a bar: the close before over its session's reference, else 1.
    pub carry: Float64Array,
    /// What a buy fills at on the bar's open, its slippage included.
    pub buy_price: Float64Array,
    pub sell_price: Float64Array,
    /// 1 where the bar is locked at its upper limit and fills no buy.
    pub buy_locked: Uint8Array,
    /// 1 where the bar is locked at its lower limit and fills no sale.
    pub sell_locked: Uint8Array,
    /// The epoch day of each bar's session.
    pub day: Int32Array,
    /// Each series the rules read, NaN where it has nothing yet.
    pub lines: Vec<Float64Array>,
    pub entry: KernelCondition,
    pub exit: KernelCondition,
    /// Sells once an adjusted close falls this fraction below the price paid.
    pub stop_loss: Option<f64>,
    /// Sells once an adjusted close rises this fraction above the price paid.
    pub take_profit: Option<f64>,
    pub capital: f64,
    pub commission_rate: f64,
    pub min_commission: f64,
    pub sell_tax_rate: f64,
    /// The first bar of the out-of-sample stretch; none without a split.
    pub split_at: Option<u32>,
}

/// How a stretch of the run went, against the account's value at the close before it.
#[napi(object, use_nullable = true)]
pub struct KernelMetrics {
    pub total_return: f64,
    pub annual_return: Option<f64>,
    pub max_drawdown: f64,
    /// Trades closed within the stretch.
    pub trades: u32,
    pub win_rate: Option<f64>,
    pub payoff_ratio: Option<f64>,
    pub exposure: f64,
    pub buy_and_hold: f64,
    pub buy_and_hold_drawdown: f64,
}

/// Every trade of the run, oldest first, one column per figure.
#[napi(object)]
pub struct KernelTrades {
    /// The bar whose fill bought.
    pub entry: Int32Array,
    /// The bar whose fill sold, -1 for a position still held at the last bar.
    pub exit: Int32Array,
    pub entry_price: Float64Array,
    /// The last close for a position still held.
    pub exit_price: Float64Array,
    /// The shares bought.
    pub shares: Float64Array,
    /// What it gained after every cost, marked at the last close while held.
    pub profit: Float64Array,
    /// That gain as a fraction of what the shares and the commission cost.
    #[napi(js_name = "return")]
    pub gain: Float64Array,
}

#[napi(object, use_nullable = true)]
pub struct BacktestRun {
    /// The account's value at each bar's close.
    pub equity: Float64Array,
    pub trades: KernelTrades,
    pub all: KernelMetrics,
    pub in_sample: Option<KernelMetrics>,
    pub out_of_sample: Option<KernelMetrics>,
}

struct Position {
    /// Fractional once a split or what went ex has carried it over.
    shares: f64,
    bought: f64,
    price: f64,
    cost: f64,
    index: usize,
}

struct Trade {
    entry: usize,
    exit: Option<usize>,
    entry_price: f64,
    exit_price: f64,
    shares: f64,
    profit: f64,
    gain: f64,
}

enum Pending {
    Buy,
    Sell,
}

fn invalid(reason: &str) -> Error {
    Error::new(Status::InvalidArg, reason.to_owned())
}

/// Runs the strategy: each rule read at a bar's close and acted on at the next bar's open. A buy
/// spends what the account holds on whole shares; a sale sells them all.
#[napi(catch_unwind)]
pub fn backtest(columns: BacktestColumns) -> Result<BacktestRun> {
    let close: &[f64] = &columns.close;
    let bars = close.len();

    if bars < 2 {
        return Err(invalid("A backtest needs two bars at least"));
    }

    let floats = [
        &columns.adjusted_close,
        &columns.factor,
        &columns.carry,
        &columns.buy_price,
        &columns.sell_price,
    ];

    if floats.iter().any(|column| column.len() != bars)
        || columns.buy_locked.len() != bars
        || columns.sell_locked.len() != bars
        || columns.day.len() != bars
        || columns.lines.iter().any(|line| line.len() != bars)
    {
        return Err(invalid("Every column holds one value a bar"));
    }

    let lines: Vec<&[f64]> = columns.lines.iter().map(|line| &line[..]).collect();
    let entry = Rule::read(&columns.entry, lines.len())?;
    let exit = Rule::read(&columns.exit, lines.len())?;
    let last = bars - 1;

    let split = match columns.split_at {
        Some(at) if at == 0 || at as usize > last => {
            return Err(invalid("A split falls after the first bar and by the last"));
        }
        split => split.map(|at| at as usize),
    };

    let commission = |value: f64| {
        (value * columns.commission_rate).max(if value > 0.0 {
            columns.min_commission
        } else {
            0.0
        })
    };

    let mut cash = columns.capital;
    let mut position: Option<Position> = None;
    let mut pending: Option<Pending> = None;
    let mut trades: Vec<Trade> = Vec::new();
    let mut equity: Vec<f64> = Vec::with_capacity(bars);
    let mut held: Vec<bool> = Vec::with_capacity(bars);

    for index in 0..bars {
        if let Some(holding) = position.as_mut() {
            holding.shares *= columns.carry[index];
        }

        match pending {
            Some(Pending::Buy) if position.is_none() && columns.buy_locked[index] == 0 => {
                let price = columns.buy_price[index];

                // The most shares whose price and commission, at its rate or its minimum, the cash covers.
                let shares = (cash / (price * (1.0 + columns.commission_rate)))
                    .floor()
                    .min(((cash - columns.min_commission) / price).floor())
                    .max(0.0);

                let fee = commission(price * shares);

                if shares > 0.0 && price * shares + fee <= cash {
                    cash -= price * shares + fee;
                    position = Some(Position {
                        shares,
                        bought: shares,
                        price,
                        cost: price * shares + fee,
                        index,
                    });
                }
            }
            Some(Pending::Sell) if columns.sell_locked[index] == 0 => {
                if let Some(holding) = position.take() {
                    let price = columns.sell_price[index];
                    let value = price * holding.shares;
                    let proceeds = value - commission(value) - value * columns.sell_tax_rate;

                    cash += proceeds;
                    trades.push(Trade {
                        entry: holding.index,
                        exit: Some(index),
                        entry_price: holding.price,
                        exit_price: price,
                        shares: holding.bought,
                        profit: proceeds - holding.cost,
                        gain: (proceeds - holding.cost) / holding.cost,
                    });
                }
            }
            _ => {}
        }

        pending = None;
        held.push(position.is_some());
        equity.push(
            cash + position
                .as_ref()
                .map_or(0.0, |holding| holding.shares * close[index]),
        );

        match &position {
            None => {
                if entry.holds(&lines, index) {
                    pending = Some(Pending::Buy);
                }
            }
            Some(holding) => {
                let change = columns.adjusted_close[index]
                    / (holding.price / columns.factor[holding.index])
                    - 1.0;

                if exit.holds(&lines, index)
                    || columns.stop_loss.is_some_and(|stop| change <= -stop)
                    || columns.take_profit.is_some_and(|target| change >= target)
                {
                    pending = Some(Pending::Sell);
                }
            }
        }
    }

    if let Some(holding) = position {
        let value = holding.shares * close[last];

        trades.push(Trade {
            entry: holding.index,
            exit: None,
            entry_price: holding.price,
            exit_price: close[last],
            shares: holding.bought,
            profit: value - holding.cost,
            gain: (value - holding.cost) / holding.cost,
        });
    }

    let run = Run {
        adjusted_close: &columns.adjusted_close,
        day: &columns.day,
        equity: &equity,
        held: &held,
        trades: &trades,
        capital: columns.capital,
    };

    Ok(BacktestRun {
        all: run.metrics(0, last),
        in_sample: split.map(|at| run.metrics(0, at - 1)),
        out_of_sample: split.map(|at| run.metrics(at, last)),
        trades: KernelTrades {
            entry: Int32Array::new(trades.iter().map(|trade| trade.entry as i32).collect()),
            exit: Int32Array::new(
                trades
                    .iter()
                    .map(|trade| trade.exit.map_or(-1, |exit| exit as i32))
                    .collect(),
            ),
            entry_price: Float64Array::new(trades.iter().map(|trade| trade.entry_price).collect()),
            exit_price: Float64Array::new(trades.iter().map(|trade| trade.exit_price).collect()),
            shares: Float64Array::new(trades.iter().map(|trade| trade.shares).collect()),
            profit: Float64Array::new(trades.iter().map(|trade| trade.profit).collect()),
            gain: Float64Array::new(trades.iter().map(|trade| trade.gain).collect()),
        },
        equity: Float64Array::new(equity),
    })
}

struct Run<'a> {
    adjusted_close: &'a [f64],
    day: &'a [i32],
    equity: &'a [f64],
    held: &'a [bool],
    trades: &'a [Trade],
    capital: f64,
}

impl Run<'_> {
    /// How the bars from `first` to `last` went, against the account's value at the close before them.
    fn metrics(&self, first: usize, last: usize) -> KernelMetrics {
        let start = if first == 0 {
            self.capital
        } else {
            self.equity[first - 1]
        };

        let end = self.equity[last];
        let days = self.day[last] - self.day[first];

        // From the close the account's value is measured from, so both start on one price; no order
        // fills on the first bar, so the first stretch's start is its first close.
        let hold_from = self.adjusted_close[first.saturating_sub(1)];

        let mut peak = start;
        let mut max_drawdown: f64 = 0.0;
        let mut hold_peak = hold_from;
        let mut buy_and_hold_drawdown: f64 = 0.0;

        for index in first..=last {
            peak = peak.max(self.equity[index]);
            max_drawdown = max_drawdown.max(1.0 - self.equity[index] / peak);
            hold_peak = hold_peak.max(self.adjusted_close[index]);
            buy_and_hold_drawdown =
                buy_and_hold_drawdown.max(1.0 - self.adjusted_close[index] / hold_peak);
        }

        let closed: Vec<&Trade> = self
            .trades
            .iter()
            .filter(|trade| trade.exit.is_some_and(|exit| exit >= first && exit <= last))
            .collect();

        let average = |trades: Vec<f64>| {
            (!trades.is_empty())
                .then(|| trades.iter().fold(0.0, |sum, profit| sum + profit) / trades.len() as f64)
        };

        let wins = closed.iter().filter(|trade| trade.profit > 0.0).count();

        let average_win = average(
            closed
                .iter()
                .map(|trade| trade.profit)
                .filter(|profit| *profit > 0.0)
                .collect(),
        );

        let average_loss = average(
            closed
                .iter()
                .map(|trade| trade.profit)
                .filter(|profit| *profit < 0.0)
                .collect(),
        );

        let held = self.held[first..=last].iter().filter(|held| **held).count();

        KernelMetrics {
            total_return: (end - start) / start,
            annual_return: (days >= SHORTEST_ANNUALIZED_DAYS && end > 0.0)
                .then(|| (end / start).powf(DAYS_A_YEAR / f64::from(days)) - 1.0),
            max_drawdown,
            trades: closed.len() as u32,
            win_rate: (!closed.is_empty()).then(|| wins as f64 / closed.len() as f64),
            payoff_ratio: average_win
                .zip(average_loss)
                .map(|(win, loss)| win / -loss),
            exposure: held as f64 / (last - first + 1) as f64,
            buy_and_hold: self.adjusted_close[last] / hold_from - 1.0,
            buy_and_hold_drawdown,
        }
    }
}
