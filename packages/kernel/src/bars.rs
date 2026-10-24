use napi::bindgen_prelude::{Float64Array, Int32Array, Uint8Array};
use napi::{Error, Result, Status};
use napi_derive::napi;

/// A listing's bars, oldest first, and what trading them costs, as `@solyx/core/backtest` prepares them.
#[napi(object)]
pub struct KernelBars {
    /// Opens as traded, which a fill's slippage is counted from.
    pub open: Float64Array,
    /// Closes as traded, which mark a holding.
    pub close: Float64Array,
    /// Opens and closes adjusted for splits and what went ex, which stops, buying and holding and
    /// the permutation test read.
    pub adjusted_open: Float64Array,
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
    pub capital: f64,
    pub commission_rate: f64,
    pub min_commission: f64,
    pub sell_tax_rate: f64,
}

/// The bars as slices, checked to hold one value a bar.
pub struct Bars<'a> {
    pub open: &'a [f64],
    pub close: &'a [f64],
    pub adjusted_open: &'a [f64],
    pub adjusted_close: &'a [f64],
    pub factor: &'a [f64],
    pub carry: &'a [f64],
    pub buy_price: &'a [f64],
    pub sell_price: &'a [f64],
    pub buy_locked: &'a [u8],
    pub sell_locked: &'a [u8],
    pub day: &'a [i32],
    pub lines: Vec<&'a [f64]>,
    pub capital: f64,
    pub commission_rate: f64,
    pub min_commission: f64,
    pub sell_tax_rate: f64,
}

pub fn invalid(reason: &str) -> Error {
    Error::new(Status::InvalidArg, reason.to_owned())
}

impl<'a> Bars<'a> {
    pub fn read(bars: &'a KernelBars) -> Result<Bars<'a>> {
        let count = bars.close.len();

        if count < 2 {
            return Err(invalid("A backtest needs two bars at least"));
        }

        let floats = [
            &bars.open,
            &bars.adjusted_open,
            &bars.adjusted_close,
            &bars.factor,
            &bars.carry,
            &bars.buy_price,
            &bars.sell_price,
        ];

        if floats.iter().any(|column| column.len() != count)
            || bars.buy_locked.len() != count
            || bars.sell_locked.len() != count
            || bars.day.len() != count
            || bars.lines.iter().any(|line| line.len() != count)
        {
            return Err(invalid("Every column holds one value a bar"));
        }

        Ok(Bars {
            open: &bars.open,
            close: &bars.close,
            adjusted_open: &bars.adjusted_open,
            adjusted_close: &bars.adjusted_close,
            factor: &bars.factor,
            carry: &bars.carry,
            buy_price: &bars.buy_price,
            sell_price: &bars.sell_price,
            buy_locked: &bars.buy_locked,
            sell_locked: &bars.sell_locked,
            day: &bars.day,
            lines: bars.lines.iter().map(|line| &line[..]).collect(),
            capital: bars.capital,
            commission_rate: bars.commission_rate,
            min_commission: bars.min_commission,
            sell_tax_rate: bars.sell_tax_rate,
        })
    }

    pub fn last(&self) -> usize {
        self.close.len() - 1
    }

    /// Whether the bar at `index` is its session's last, whose close the account is valued at.
    pub fn closes_session(&self, index: usize) -> bool {
        index == self.last() || self.day[index + 1] != self.day[index]
    }

    /// The first bar of each session.
    pub fn sessions(&self) -> Vec<usize> {
        (0..self.close.len())
            .filter(|&index| index == 0 || self.day[index] != self.day[index - 1])
            .collect()
    }

    /// What a trade of `value` pays its broker, at its rate or its minimum.
    pub fn commission(&self, value: f64) -> f64 {
        (value * self.commission_rate).max(if value > 0.0 {
            self.min_commission
        } else {
            0.0
        })
    }

    /// The first bar of the out-of-sample stretch, checked to fall after the first bar and by the last.
    pub fn split(&self, split_at: Option<u32>) -> Result<Option<usize>> {
        match split_at {
            Some(at) if at == 0 || at as usize > self.last() => Err(invalid(
                "A split falls after the first bar and by the last",
            )),
            split => Ok(split.map(|at| at as usize)),
        }
    }
}
