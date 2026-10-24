use napi::Result;
use napi::bindgen_prelude::{Float64Array, Int32Array};
use napi_derive::napi;

use crate::bars::{Bars, KernelBars};
use crate::metrics::KernelStretches;
use crate::rule::{KernelStrategy, Strategy};
use crate::simulate::simulate;

#[napi(object)]
pub struct BacktestRequest {
    pub bars: KernelBars,
    pub strategy: KernelStrategy,
    /// The first bar of the out-of-sample stretch; none without a split.
    pub split_at: Option<u32>,
    /// How many orderings of each stretch's bars its timing is tested against; 0 tests none.
    pub permutations: u32,
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

#[napi(object)]
pub struct BacktestRun {
    /// The account's value at each bar's close.
    pub equity: Float64Array,
    pub trades: KernelTrades,
    pub stretches: KernelStretches,
}

/// Runs one strategy over every bar, holding nothing at the first.
#[napi(catch_unwind)]
pub fn backtest(request: BacktestRequest) -> Result<BacktestRun> {
    let bars = Bars::read(&request.bars)?;
    let strategy = Strategy::read(&request.strategy, bars.lines.len())?;
    let split = bars.split(request.split_at)?;
    let path = simulate(&bars, |_| Some(&strategy), 0, bars.last());
    let trades = &path.trades;

    Ok(BacktestRun {
        stretches: bars.stretches(&path, split, request.permutations),
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
        equity: Float64Array::new(path.equity),
    })
}
