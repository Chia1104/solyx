import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";

/** A price range shaded across the pane, such as a support zone or a volume profile's slice. */
export interface PriceBand {
  low: number;
  high: number;
  /** The fill, translucent so bars read through it. */
  color: string;
  /**
   * Share of the pane's width the band spans, from its right edge.
   * @default 1
   */
  width?: number;
  /** Written inside the band's left end. */
  label?: string;
  /** @default the chart's text colour */
  labelColor?: string;
}

type RenderTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

const LABEL_INSET = 4;

/**
 * Draws bands behind a series' bars at their prices on its scale. They do not widen the scale,
 * so a band outside the prices in view stays out of view.
 */
export class PriceBands implements ISeriesPrimitive<Time> {
  #bands: readonly PriceBand[] = [];

  #attached: SeriesAttachedParameter<Time> | null = null;

  readonly #views: readonly IPrimitivePaneView[];

  constructor() {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) => this.#draw(target),
    };

    this.#views = [{ zOrder: () => "bottom", renderer: () => renderer }];
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.#attached = param;
  }

  detached() {
    this.#attached = null;
  }

  paneViews() {
    return this.#views;
  }

  setBands(bands: readonly PriceBand[]) {
    this.#bands = bands;
    this.#attached?.requestUpdate();
  }

  #draw(target: RenderTarget) {
    if (!this.#attached) return;

    const { series, chart } = this.#attached;
    const { fontSize, fontFamily, textColor } = chart.options().layout;

    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      context.font = `${fontSize}px ${fontFamily}`;
      context.textBaseline = "top";

      for (const band of this.#bands) {
        const top = series.priceToCoordinate(band.high);
        const bottom = series.priceToCoordinate(band.low);

        if (top === null || bottom === null) continue;

        const width = mediaSize.width * (band.width ?? 1);
        const left = mediaSize.width - width;

        context.fillStyle = band.color;
        context.fillRect(left, top, width, Math.max(bottom - top, 1));

        if (band.label) {
          context.fillStyle = band.labelColor ?? textColor;
          context.fillText(band.label, left + LABEL_INSET, top + LABEL_INSET);
        }
      }
    });
  }
}
