use napi::Result;
use napi_derive::napi;
use rayon::prelude::*;

use crate::bars::{Bars, KernelBars, invalid};
use crate::metrics::KernelMetrics;
use crate::rule::{KernelStrategy, Strategy};
use crate::simulate::simulate;

/// The bars a window runs over, from its first to its last.
#[napi(object)]
pub struct KernelSpan {
    pub first: u32,
    pub last: u32,
}

#[napi(object)]
pub struct RollingRequest {
    pub bars: KernelBars,
    pub strategy: KernelStrategy,
    pub windows: Vec<KernelSpan>,
}

#[napi(object)]
pub struct RollingRun {
    /// Each window's figures, in the order they came.
    pub windows: Vec<KernelMetrics>,
}

/// Runs one strategy over each window on its own, all at once, holding nothing at the close before
/// the window's first bar. Its rules are read from that close, so its first fill may come at the
/// first bar's open, and its figures and holding's are measured from there; a window from the very
/// first bar, which has no close before it, starts at that bar's close.
#[napi(catch_unwind)]
pub fn rolling(request: RollingRequest) -> Result<RollingRun> {
    let bars = Bars::read(&request.bars)?;
    let strategy = Strategy::read(&request.strategy, bars.lines.len())?;

    if request
        .windows
        .iter()
        .any(|window| window.first >= window.last || window.last as usize > bars.last())
    {
        return Err(invalid("A window runs from one bar to a later one, by the last"));
    }

    let windows = request
        .windows
        .par_iter()
        .map(|window| {
            let (first, last) = (window.first as usize, window.last as usize);
            let path = simulate(&bars, |_| Some(&strategy), first.saturating_sub(1), last);

            bars.metrics(&path, first, last, 0)
        })
        .collect();

    Ok(RollingRun { windows })
}
