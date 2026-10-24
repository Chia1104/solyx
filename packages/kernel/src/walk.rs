use napi::Result;
use napi::bindgen_prelude::Float64Array;
use napi_derive::napi;
use rayon::prelude::*;

use crate::bars::{Bars, KernelBars, invalid};
use crate::metrics::KernelMetrics;
use crate::rule::{KernelStrategy, Strategy};
use crate::scan::{grid, plateau};
use crate::simulate::simulate;

#[napi(object)]
pub struct WalkForwardRequest {
    pub bars: KernelBars,
    pub strategies: Vec<KernelStrategy>,
    /// How many strategies a row of the grid they make holds, row by row; none where they make none.
    pub columns: Option<u32>,
    /// The sessions each window trains on.
    pub train: u32,
    /// The sessions each window then tests on, which is how far the next window moves on.
    pub test: u32,
    /// How many orderings of the tests' bars their timing is tested against; 0 tests none.
    pub permutations: u32,
}

/// One window: the bars it trained on and tested on, and the strategy its training picked.
#[napi(object, use_nullable = true)]
pub struct KernelWindow {
    pub train_first: u32,
    pub train_last: u32,
    pub test_first: u32,
    pub test_last: u32,
    /// None where no strategy had a Sharpe ratio over the training, and the test then holds nothing.
    pub cell: Option<u32>,
    /// The picked strategy's own Sharpe ratio over the training, not its neighbourhood's.
    pub train_sharpe: Option<f64>,
}

#[napi(object, use_nullable = true)]
pub struct WalkForwardRun {
    pub windows: Vec<KernelWindow>,
    /// The tests' bars run as one, each under its window's pick, holding nothing at the first.
    pub out_of_sample: KernelMetrics,
    /// The account's value at each bar's close from the first test bar on.
    pub equity: Float64Array,
    /// The out-of-sample Sharpe ratio over the mean of the picks' training ones.
    pub efficiency: Option<f64>,
}

/// The cell with the highest score; none where none has one.
fn best(scores: &[Option<f64>]) -> Option<usize> {
    scores
        .iter()
        .enumerate()
        .filter_map(|(cell, score)| score.map(|score| (cell, score)))
        .fold(None, |best: Option<(usize, f64)>, (cell, score)| match best {
            Some((_, kept)) if kept >= score => best,
            _ => Some((cell, score)),
        })
        .map(|(cell, _)| cell)
}

/// Picks a strategy on each window's training, by the grid's plateau where they make one, applies
/// it to the sessions after, and runs those tests as one: a holding carries over from one test to the
/// next, and the next pick's rules decide what it does.
#[napi(catch_unwind)]
pub fn walk_forward(request: WalkForwardRequest) -> Result<WalkForwardRun> {
    let bars = Bars::read(&request.bars)?;
    let strategies = Strategy::read_all(&request.strategies, bars.lines.len())?;
    let columns = grid(strategies.len(), request.columns)?;
    let sessions = bars.sessions();
    let (train, test) = (request.train as usize, request.test as usize);
    let last = bars.last();

    if train == 0 || test == 0 || sessions.len() <= train {
        return Err(invalid(
            "A walk forward trains and tests on one session at least, and its first training leaves sessions to test",
        ));
    }

    let ends = |session: usize| sessions.get(session).map_or(last, |first| first - 1);

    let mut windows: Vec<KernelWindow> = (0..)
        .map(|window| window * test)
        .take_while(|start| start + train < sessions.len())
        .map(|start| KernelWindow {
            train_first: sessions[start] as u32,
            train_last: ends(start + train) as u32,
            test_first: sessions[start + train] as u32,
            test_last: ends(start + train + test) as u32,
            cell: None,
            train_sharpe: None,
        })
        .collect();

    windows.par_iter_mut().for_each(|window| {
        let (first, end) = (window.train_first as usize, window.train_last as usize);

        let scores: Vec<Option<f64>> = strategies
            .par_iter()
            .map(|strategy| {
                let path = simulate(&bars, |_| Some(strategy), first, end);

                bars.metrics(&path, first, end, 0).sharpe
            })
            .collect();

        let cell = match columns {
            Some(columns) => plateau(&scores, columns).map(|plateau| plateau.cell as usize),
            None => best(&scores),
        };

        window.cell = cell.map(|cell| cell as u32);
        window.train_sharpe = cell.and_then(|cell| scores[cell]);
    });

    let first = windows[0].test_first as usize;
    let mut schedule: Vec<Option<usize>> = vec![None; last - first + 1];

    for window in &windows {
        for index in window.test_first..=window.test_last {
            schedule[index as usize - first] = window.cell.map(|cell| cell as usize);
        }
    }

    let path = simulate(
        &bars,
        |index| schedule[index - first].map(|cell| &strategies[cell]),
        first,
        last,
    );

    let out_of_sample = bars.metrics(&path, first, last, request.permutations);

    let trained: Vec<f64> = windows.iter().filter_map(|window| window.train_sharpe).collect();
    let mean = trained.iter().sum::<f64>() / trained.len() as f64;

    Ok(WalkForwardRun {
        efficiency: out_of_sample
            .sharpe
            .filter(|_| !trained.is_empty() && mean != 0.0)
            .map(|sharpe| sharpe / mean),
        out_of_sample,
        equity: Float64Array::new(path.equity),
        windows,
    })
}
