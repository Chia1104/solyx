/** A column in a plot, as shares of the plot's height. */
export interface ColumnPlace {
  /** How far its upper edge is from the plot's top. */
  top: number;
  height: number;
  /** Whether it falls from zero rather than rises from it. */
  falls: boolean;
}

export interface ColumnScale {
  /** Where zero lies from the plot's top. */
  zero: number;
  /** One per figure given; `null` for a figure that is missing. */
  columns: (ColumnPlace | null)[];
}

/**
 * Places columns on one scale that always holds zero, so each stands on it or hangs from it and
 * none has its foot cut off. Where every figure is zero or missing, zero is the plot's floor.
 */
export function columnScale(figures: readonly (number | null)[]): ColumnScale {
  const known = figures.filter((figure) => figure !== null);
  const top = Math.max(0, ...known);
  const span = top - Math.min(0, ...known);

  if (span === 0) {
    return {
      zero: 1,
      columns: figures.map((figure) =>
        figure === null ? null : { top: 1, height: 0, falls: false }
      ),
    };
  }

  return {
    zero: top / span,
    columns: figures.map((figure) =>
      figure === null
        ? null
        : {
            top: (top - Math.max(figure, 0)) / span,
            height: Math.abs(figure) / span,
            falls: figure < 0,
          }
    ),
  };
}

/** The calendar quarter a statement's last day closes. */
export function quarterOf(periodEnd: string) {
  const { year, month } = Temporal.PlainDate.from(periodEnd);

  return { year, quarter: Math.ceil(month / 3) };
}
