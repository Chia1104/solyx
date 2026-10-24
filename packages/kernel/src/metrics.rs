use napi_derive::napi;
use rayon::prelude::*;

use crate::bars::Bars;
use crate::simulate::{Path, Trade};

const DAYS_A_YEAR: f64 = 365.25;

// A stretch shorter than this has no yearly pace worth naming.
const SHORTEST_ANNUALIZED_DAYS: i32 = 28;

// Every run's orderings start from it, so a test gives the same answer each time.
const PERMUTATION_SEED: u64 = 0x5EED_0F5E_55A1_0000;

/// How a stretch of a run went, against the account's value at the close before it.
#[napi(object, use_nullable = true)]
pub struct KernelMetrics {
    pub total_return: f64,
    /// The return a year at that pace, `null` over a stretch shorter than a month.
    pub annual_return: Option<f64>,
    /// The deepest fall of the account's value from a high before it, as a fraction.
    pub max_drawdown: f64,
    /// The mean of the account's returns from one session's close to the next over their
    /// deviation, a year's worth at their pace; `null` over a stretch shorter than a month or
    /// that never moved.
    pub sharpe: Option<f64>,
    /// How often the stretch's bars ordered at random did as well as the rules' timing did on
    /// them, the orderings held as the run held and charged its costs: below 0.05 the timing beat
    /// chance; `null` where the run tested none, or held nothing.
    pub p_value: Option<f64>,
    /// Trades closed within it; one still held is not counted.
    pub trades: u32,
    pub win_rate: Option<f64>,
    /// The average gain over the size of the average loss; `null` without both.
    pub payoff_ratio: Option<f64>,
    /// The part of its bars a position was held through.
    pub exposure: f64,
    /// What holding the listing through it would have returned, from the close its return is
    /// measured from to its last, before costs, with what went ex bought back in as the rules'
    /// prices have it.
    pub buy_and_hold: f64,
    /// The deepest fall holding it would have taken from a high before it, as a fraction, on the
    /// closes `buyAndHold` reads.
    pub buy_and_hold_drawdown: f64,
}

/// A run's figures over all its bars, and before and from its split where it has one.
#[napi(object, use_nullable = true)]
pub struct KernelStretches {
    pub all: KernelMetrics,
    pub in_sample: Option<KernelMetrics>,
    pub out_of_sample: Option<KernelMetrics>,
}

fn mean_over_deviation(values: impl Iterator<Item = f64> + Clone) -> Option<f64> {
    let count = values.clone().count() as f64;

    if count < 2.0 {
        return None;
    }

    let mean = values.clone().sum::<f64>() / count;
    let variance = values.map(|value| (value - mean).powi(2)).sum::<f64>() / (count - 1.0);

    (variance > 0.0).then(|| mean / variance.sqrt())
}

fn average(values: impl Iterator<Item = f64>) -> Option<f64> {
    let (sum, count) = values.fold((0.0, 0usize), |(sum, count), value| (sum + value, count + 1));

    (count > 0).then(|| sum / count as f64)
}

/// The next of a stream seeded by `state`, after SplitMix64.
fn next(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);

    let mut mixed = *state;

    mixed = (mixed ^ (mixed >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    mixed = (mixed ^ (mixed >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);

    mixed ^ (mixed >> 31)
}

impl Bars<'_> {
    /// How the bars from `first` to `last` went for `path`, against the account's value at the close
    /// before them, its timing tested against `permutations` orderings of them where that is not 0.
    pub fn metrics(&self, path: &Path, first: usize, last: usize, permutations: u32) -> KernelMetrics {
        let start = path.equity_before(first, self.capital);
        let end = path.equity_at(last);
        let days = self.day[last] - self.day[first];

        // From the close the account's value is measured from, so both start on one price; no order
        // fills on a run's first bar, so its first stretch starts on that bar's close.
        let hold_from = self.adjusted_close[first.saturating_sub(1)];

        let mut peak = start;
        let mut max_drawdown: f64 = 0.0;
        let mut hold_peak = hold_from;
        let mut buy_and_hold_drawdown: f64 = 0.0;

        for index in first..=last {
            peak = peak.max(path.equity_at(index));
            max_drawdown = max_drawdown.max(1.0 - path.equity_at(index) / peak);
            hold_peak = hold_peak.max(self.adjusted_close[index]);
            buy_and_hold_drawdown =
                buy_and_hold_drawdown.max(1.0 - self.adjusted_close[index] / hold_peak);
        }

        let closed: Vec<&Trade> = path
            .trades
            .iter()
            .filter(|trade| trade.exit.is_some_and(|exit| exit >= first && exit <= last))
            .collect();

        let profits = closed.iter().map(|trade| trade.profit);
        let wins = profits.clone().filter(|profit| *profit > 0.0).count();
        let average_win = average(profits.clone().filter(|profit| *profit > 0.0));
        let average_loss = average(profits.filter(|profit| *profit < 0.0));
        let held = (first..=last).filter(|&index| path.held_at(index)).count();
        let annualized = days >= SHORTEST_ANNUALIZED_DAYS;

        KernelMetrics {
            total_return: (end - start) / start,
            annual_return: (annualized && end > 0.0)
                .then(|| (end / start).powf(DAYS_A_YEAR / f64::from(days)) - 1.0),
            max_drawdown,
            sharpe: if annualized {
                self.sharpe(path, first, last, start, days)
            } else {
                None
            },
            p_value: (permutations > 0)
                .then(|| self.permutation_test(path, first, last, permutations))
                .flatten(),
            trades: closed.len() as u32,
            win_rate: (!closed.is_empty()).then(|| wins as f64 / closed.len() as f64),
            payoff_ratio: average_win.zip(average_loss).map(|(win, loss)| win / -loss),
            exposure: held as f64 / (last - first + 1) as f64,
            buy_and_hold: self.adjusted_close[last] / hold_from - 1.0,
            buy_and_hold_drawdown,
        }
    }

    pub fn stretches(
        &self,
        path: &Path,
        split: Option<usize>,
        permutations: u32,
    ) -> KernelStretches {
        let last = self.last();

        KernelStretches {
            all: self.metrics(path, path.first, last, permutations),
            in_sample: split.map(|at| self.metrics(path, path.first, at - 1, permutations)),
            out_of_sample: split.map(|at| self.metrics(path, at, last, permutations)),
        }
    }

    /// The Sharpe ratio of the account's returns from one session's close to the next, from `start`.
    fn sharpe(&self, path: &Path, first: usize, last: usize, start: f64, days: i32) -> Option<f64> {
        let closes: Vec<f64> = (first..=last)
            .filter(|&index| self.closes_session(index))
            .map(|index| path.equity_at(index))
            .collect();

        let returns = closes
            .iter()
            .scan(start, |before, &close| {
                let change = close / *before - 1.0;

                *before = close;

                Some(change)
            })
            .collect::<Vec<_>>();

        let per_year = returns.len() as f64 / (f64::from(days) / DAYS_A_YEAR);

        mean_over_deviation(returns.iter().copied()).map(|ratio| ratio * per_year.sqrt())
    }

    /// How often `permutations` orderings of the bars' moves did as well as the run's own: each bar's
    /// move from the close before to its open and from its open to its close, held as the run held
    /// them, less what its fills cost. The holding stays as it was, so only its timing is tested.
    fn permutation_test(&self, path: &Path, first: usize, last: usize, permutations: u32) -> Option<f64> {
        let start = first.max(1);

        if start > last {
            return None;
        }

        let moves: Vec<(f64, f64)> = (start..=last)
            .map(|index| {
                (
                    self.adjusted_open[index] / self.adjusted_close[index - 1] - 1.0,
                    self.adjusted_close[index] / self.adjusted_open[index] - 1.0,
                )
            })
            .collect();

        let held: Vec<(f64, f64)> = (start..=last)
            .map(|index| {
                (
                    f64::from(u8::from(path.held_at(index - 1))),
                    f64::from(u8::from(path.held_at(index))),
                )
            })
            .collect();

        let costs: Vec<f64> = (start..=last)
            .map(|index| path.cost_at(index) / path.equity_before(index, self.capital))
            .collect();

        let score = |moves: &[(f64, f64)]| {
            mean_over_deviation(moves.iter().zip(&held).zip(&costs).map(
                |(((overnight, session), (before, after)), cost)| {
                    before * overnight + after * session - cost
                },
            ))
        };

        let actual = score(&moves)?;

        let beaten = (0..permutations)
            .into_par_iter()
            .filter(|&ordering| {
                let mut shuffled = moves.clone();
                let mut state = PERMUTATION_SEED ^ (u64::from(ordering) << 20) ^ first as u64;

                for index in (1..shuffled.len()).rev() {
                    let pick = ((u128::from(next(&mut state)) * (index as u128 + 1)) >> 64) as usize;

                    shuffled.swap(index, pick);
                }

                score(&shuffled).is_some_and(|permuted| permuted >= actual)
            })
            .count();

        Some((beaten + 1) as f64 / (f64::from(permutations) + 1.0))
    }
}
