use napi::Result;
use napi_derive::napi;

use crate::bars::invalid;

/// A rule as `@solyx/core/backtest` declares it, each series named by its place in the lines.
#[napi(object)]
pub struct KernelCondition {
    pub all: Option<Vec<KernelCondition>>,
    pub any: Option<Vec<KernelCondition>>,
    pub above: Option<Vec<u32>>,
    pub below: Option<Vec<u32>>,
    pub crosses_above: Option<Vec<u32>>,
    pub crosses_below: Option<Vec<u32>>,
}

pub enum Rule {
    All(Vec<Rule>),
    Any(Vec<Rule>),
    Above(usize, usize),
    Below(usize, usize),
    CrossesAbove(usize, usize),
    CrossesBelow(usize, usize),
}

fn pair(series: &[u32], lines: usize) -> Result<(usize, usize)> {
    let [left, right] = series else {
        return Err(invalid("A comparison reads two series"));
    };

    let (left, right) = (*left as usize, *right as usize);

    if left >= lines || right >= lines {
        return Err(invalid("A comparison reads a series the lines do not hold"));
    }

    Ok((left, right))
}

impl Rule {
    /// Reads `condition` once, so each bar walks a rule whose series are known to be there.
    pub fn read(condition: &KernelCondition, lines: usize) -> Result<Rule> {
        let branches = |conditions: &[KernelCondition]| {
            conditions
                .iter()
                .map(|each| Rule::read(each, lines))
                .collect::<Result<Vec<_>>>()
        };

        match condition {
            KernelCondition { all: Some(all), .. } => Ok(Rule::All(branches(all)?)),
            KernelCondition { any: Some(any), .. } => Ok(Rule::Any(branches(any)?)),
            KernelCondition { above: Some(series), .. } => {
                pair(series, lines).map(|(left, right)| Rule::Above(left, right))
            }
            KernelCondition { below: Some(series), .. } => {
                pair(series, lines).map(|(left, right)| Rule::Below(left, right))
            }
            KernelCondition {
                crosses_above: Some(series),
                ..
            } => pair(series, lines).map(|(left, right)| Rule::CrossesAbove(left, right)),
            KernelCondition {
                crosses_below: Some(series),
                ..
            } => pair(series, lines).map(|(left, right)| Rule::CrossesBelow(left, right)),
            _ => Err(invalid("A condition names none of its kinds")),
        }
    }

    /// Whether the rule holds at `index`, where a series with no value yet (NaN) holds nothing.
    pub fn holds(&self, lines: &[&[f64]], index: usize) -> bool {
        match self {
            Rule::All(rules) => rules.iter().all(|rule| rule.holds(lines, index)),
            Rule::Any(rules) => rules.iter().any(|rule| rule.holds(lines, index)),
            Rule::Above(left, right) => lines[*left][index] > lines[*right][index],
            Rule::Below(left, right) => lines[*left][index] < lines[*right][index],
            Rule::CrossesAbove(left, right) => {
                index > 0
                    && lines[*left][index - 1] <= lines[*right][index - 1]
                    && lines[*left][index] > lines[*right][index]
            }
            Rule::CrossesBelow(left, right) => {
                index > 0
                    && lines[*left][index - 1] >= lines[*right][index - 1]
                    && lines[*left][index] < lines[*right][index]
            }
        }
    }
}

/// A long-only strategy: when to buy while holding nothing, and when to sell all of it.
#[napi(object)]
pub struct KernelStrategy {
    pub entry: KernelCondition,
    pub exit: KernelCondition,
    /// Sells once an adjusted close falls this fraction below the price paid.
    pub stop_loss: Option<f64>,
    /// Sells once an adjusted close rises this fraction above the price paid.
    pub take_profit: Option<f64>,
}

/// A strategy whose rules were read once against the lines.
pub struct Strategy {
    pub entry: Rule,
    pub exit: Rule,
    pub stop_loss: Option<f64>,
    pub take_profit: Option<f64>,
}

impl Strategy {
    pub fn read(strategy: &KernelStrategy, lines: usize) -> Result<Strategy> {
        Ok(Strategy {
            entry: Rule::read(&strategy.entry, lines)?,
            exit: Rule::read(&strategy.exit, lines)?,
            stop_loss: strategy.stop_loss,
            take_profit: strategy.take_profit,
        })
    }

    pub fn read_all(strategies: &[KernelStrategy], lines: usize) -> Result<Vec<Strategy>> {
        if strategies.is_empty() {
            return Err(invalid("A run takes one strategy at least"));
        }

        strategies
            .iter()
            .map(|strategy| Strategy::read(strategy, lines))
            .collect()
    }
}
