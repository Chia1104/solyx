use crate::bars::Bars;
use crate::rule::Strategy;

/// A trade of a run, its bars counted from the first of all.
pub struct Trade {
    pub entry: usize,
    pub exit: Option<usize>,
    pub entry_price: f64,
    pub exit_price: f64,
    pub shares: f64,
    pub profit: f64,
    pub gain: f64,
}

/// What a run did from its first bar to its last, one value a bar.
pub struct Path {
    pub first: usize,
    /// The account's value at each bar's close.
    pub equity: Vec<f64>,
    /// Whether a position was held at each bar's close.
    pub held: Vec<bool>,
    /// What each bar's fills cost in the market's currency: commission, tax and slippage from the open.
    pub costs: Vec<f64>,
    pub trades: Vec<Trade>,
}

impl Path {
    pub fn equity_at(&self, index: usize) -> f64 {
        self.equity[index - self.first]
    }

    /// Whether a position was held at `index`'s close; none before the run began.
    pub fn held_at(&self, index: usize) -> bool {
        index >= self.first && self.held[index - self.first]
    }

    pub fn cost_at(&self, index: usize) -> f64 {
        self.costs[index - self.first]
    }

    /// The account's value at the close before `index`, the capital before the run began.
    pub fn equity_before(&self, index: usize, capital: f64) -> f64 {
        if index > self.first {
            self.equity_at(index - 1)
        } else {
            capital
        }
    }
}

struct Position {
    /// Fractional once a split or what went ex has carried it over.
    shares: f64,
    bought: f64,
    price: f64,
    cost: f64,
    index: usize,
}

enum Pending {
    Buy,
    Sell,
}

/// Runs the bars from `first` to `last`, holding nothing at `first`: each rule read at a bar's close
/// and acted on at the next bar's open. `strategy` names the rules a bar is read by; a bar without
/// any buys nothing and sells what is held. A buy spends what the account holds on whole shares; a
/// sale sells them all.
pub fn simulate<'s>(
    bars: &Bars,
    strategy: impl Fn(usize) -> Option<&'s Strategy>,
    first: usize,
    last: usize,
) -> Path {
    let count = last - first + 1;
    let mut cash = bars.capital;
    let mut position: Option<Position> = None;
    let mut pending: Option<Pending> = None;

    let mut path = Path {
        first,
        equity: Vec::with_capacity(count),
        held: Vec::with_capacity(count),
        costs: Vec::with_capacity(count),
        trades: Vec::new(),
    };

    for index in first..=last {
        let mut cost = 0.0;

        if let Some(holding) = position.as_mut() {
            holding.shares *= bars.carry[index];
        }

        match pending {
            Some(Pending::Buy) if position.is_none() && bars.buy_locked[index] == 0 => {
                let price = bars.buy_price[index];

                // The most shares whose price and commission, at its rate or its minimum, the cash covers.
                let shares = (cash / (price * (1.0 + bars.commission_rate)))
                    .floor()
                    .min(((cash - bars.min_commission) / price).floor())
                    .max(0.0);

                let fee = bars.commission(price * shares);

                if shares > 0.0 && price * shares + fee <= cash {
                    cash -= price * shares + fee;
                    cost = (price - bars.open[index]) * shares + fee;
                    position = Some(Position {
                        shares,
                        bought: shares,
                        price,
                        cost: price * shares + fee,
                        index,
                    });
                }
            }
            Some(Pending::Sell) if bars.sell_locked[index] == 0 => {
                if let Some(holding) = position.take() {
                    let price = bars.sell_price[index];
                    let value = price * holding.shares;
                    let commission = bars.commission(value);
                    let tax = value * bars.sell_tax_rate;
                    let proceeds = value - commission - tax;

                    cash += proceeds;
                    cost = (bars.open[index] - price) * holding.shares + commission + tax;
                    path.trades.push(Trade {
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

        path.held.push(position.is_some());
        path.costs.push(cost);
        path.equity.push(
            cash + position
                .as_ref()
                .map_or(0.0, |holding| holding.shares * bars.close[index]),
        );

        let rules = strategy(index);

        pending = match (&position, rules) {
            (None, Some(rules)) if rules.entry.holds(&bars.lines, index) => Some(Pending::Buy),
            (Some(_), None) => Some(Pending::Sell),
            (Some(holding), Some(rules)) => {
                let change = bars.adjusted_close[index]
                    / (holding.price / bars.factor[holding.index])
                    - 1.0;

                (rules.exit.holds(&bars.lines, index)
                    || rules.stop_loss.is_some_and(|stop| change <= -stop)
                    || rules.take_profit.is_some_and(|target| change >= target))
                .then_some(Pending::Sell)
            }
            _ => None,
        };
    }

    if let Some(holding) = position {
        let value = holding.shares * bars.close[last];

        path.trades.push(Trade {
            entry: holding.index,
            exit: None,
            entry_price: holding.price,
            exit_price: bars.close[last],
            shares: holding.bought,
            profit: value - holding.cost,
            gain: (value - holding.cost) / holding.cost,
        });
    }

    path
}
