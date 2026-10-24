use napi::Result;
use napi_derive::napi;
use rayon::prelude::*;

use crate::bars::{Bars, KernelBars, invalid};
use crate::metrics::KernelStretches;
use crate::rule::{KernelStrategy, Strategy};
use crate::simulate::simulate;

#[napi(object)]
pub struct ScanRequest {
    pub bars: KernelBars,
    pub strategies: Vec<KernelStrategy>,
    /// The first bar of the out-of-sample stretch; none without a split.
    pub split_at: Option<u32>,
    /// How many strategies a row of the grid they make holds, row by row; none where they make none.
    pub columns: Option<u32>,
}

/// The cell of a grid whose neighbourhood did best.
#[napi(object)]
pub struct KernelPlateau {
    pub cell: u32,
    /// The mean Sharpe ratio of the cell and its neighbours that have one.
    pub sharpe: f64,
    /// Whether it lies on the grid's edge, where the best of the neighbourhood may lie past it.
    pub edge: bool,
}

#[napi(object, use_nullable = true)]
pub struct ScanRun {
    /// Each strategy's stretches, in the order they came.
    pub cells: Vec<KernelStretches>,
    /// Picked on the in-sample stretch where there is a split, else on all the bars.
    pub plateau: Option<KernelPlateau>,
}

/// The number of cells a grid of `columns` takes, checked to fill whole rows.
pub fn grid(cells: usize, columns: Option<u32>) -> Result<Option<usize>> {
    match columns {
        Some(columns) if columns == 0 || cells % columns as usize != 0 => Err(invalid(
            "A grid's strategies fill whole rows of its columns",
        )),
        columns => Ok(columns.map(|columns| columns as usize)),
    }
}

/// The cell of a row-by-row grid of `scores` whose neighbourhood, itself and the cells beside it
/// that have a score, has the highest mean; none where no cell has one.
pub fn plateau(scores: &[Option<f64>], columns: usize) -> Option<KernelPlateau> {
    let rows = scores.len() / columns;

    let neighbourhood = |cell: usize| {
        let (row, column) = (cell / columns, cell % columns);
        let mut sum = 0.0;
        let mut count = 0.0;

        for near_row in row.saturating_sub(1)..=(row + 1).min(rows - 1) {
            for near_column in column.saturating_sub(1)..=(column + 1).min(columns - 1) {
                if let Some(score) = scores[near_row * columns + near_column] {
                    sum += score;
                    count += 1.0;
                }
            }
        }

        sum / count
    };

    let (cell, sharpe) = scores
        .iter()
        .enumerate()
        .filter(|(_, score)| score.is_some())
        .map(|(cell, _)| (cell, neighbourhood(cell)))
        .fold(None, |best: Option<(usize, f64)>, (cell, mean)| match best {
            Some((_, kept)) if kept >= mean => best,
            _ => Some((cell, mean)),
        })?;

    let (row, column) = (cell / columns, cell % columns);

    Some(KernelPlateau {
        cell: cell as u32,
        sharpe,
        edge: (rows > 1 && (row == 0 || row == rows - 1))
            || (columns > 1 && (column == 0 || column == columns - 1)),
    })
}

/// Runs each strategy over every bar on its own, holding nothing at the first, all at once.
#[napi(catch_unwind)]
pub fn scan(request: ScanRequest) -> Result<ScanRun> {
    let bars = Bars::read(&request.bars)?;
    let strategies = Strategy::read_all(&request.strategies, bars.lines.len())?;
    let split = bars.split(request.split_at)?;
    let columns = grid(strategies.len(), request.columns)?;

    let cells: Vec<KernelStretches> = strategies
        .par_iter()
        .map(|strategy| {
            let path = simulate(&bars, |_| Some(strategy), 0, bars.last());

            bars.stretches(&path, split, 0)
        })
        .collect();

    let scores: Vec<Option<f64>> = cells
        .iter()
        .map(|cell| cell.in_sample.as_ref().unwrap_or(&cell.all).sharpe)
        .collect();

    Ok(ScanRun {
        plateau: columns.and_then(|columns| plateau(&scores, columns)),
        cells,
    })
}

#[cfg(test)]
mod tests {
    use super::{grid, plateau};

    #[test]
    fn a_row_picks_the_cell_whose_neighbours_did_well_too() {
        let picked = plateau(&[Some(3.0), Some(0.0), Some(2.0)], 3).unwrap();

        assert_eq!(picked.cell, 1);
        assert!((picked.sharpe - 5.0 / 3.0).abs() < 1e-12);
        assert!(!picked.edge);
    }

    #[test]
    fn a_cell_best_alone_loses_to_a_plateau_on_the_edge() {
        #[rustfmt::skip]
        let scores = [
            Some(9.0), Some(0.0), Some(0.0),
            Some(0.0), Some(4.0), Some(4.0),
            Some(0.0), Some(4.0), Some(4.0),
        ];

        let picked = plateau(&scores, 3).unwrap();

        assert_eq!(picked.cell, 8);
        assert!((picked.sharpe - 4.0).abs() < 1e-12);
        assert!(picked.edge);
    }

    #[test]
    fn cells_without_a_score_count_for_no_neighbour() {
        // The second's neighbours have no score, so it stands for 1, while the last stands for 2.
        let picked = plateau(&[None, Some(1.0), None, Some(2.0)], 4).unwrap();

        assert_eq!(picked.cell, 3);
        assert!((picked.sharpe - 2.0).abs() < 1e-12);
        assert_eq!(plateau(&[None, None], 2).map(|picked| picked.cell), None);
    }

    #[test]
    fn a_grid_fills_whole_rows() {
        assert!(grid(6, Some(4)).is_err());
        assert!(grid(6, Some(0)).is_err());
        assert_eq!(grid(6, Some(3)).unwrap(), Some(3));
        assert_eq!(grid(6, None).unwrap(), None);
    }
}
