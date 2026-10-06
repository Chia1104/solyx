import { groupBy } from "es-toolkit";

import { Interval, candleDate } from "./candles.ts";
import type { Candle } from "./candles.ts";
import { checkForecast, forecastRecord, judgeForecast } from "./forecast.ts";
import type {
  Forecast,
  ForecastDraft,
  ForecastOutcome,
  ForecastRecord,
  ForecastViolation,
} from "./forecast.ts";
import type { MarketData } from "./market-data.ts";
import { symbolKey } from "./market.ts";
import type { SymbolRef } from "./market.ts";
import { reviseReport } from "./report.ts";
import type { Report, ReportDraft, Revision } from "./report.ts";

/** Where research persists. Synchronous so the desk checks a forecast and keeps it without an await between. */
export interface ResearchStore {
  /** A listing's newest revision. */
  report(symbol: SymbolRef): Report | undefined;
  addReport(report: Report): void;
  forecast(id: string): Forecast | undefined;
  /** One listing's forecasts, or every listing's, oldest first. */
  forecasts(symbol?: SymbolRef): Forecast[];
  addForecast(forecast: Forecast): void;
  /** Keeps how a forecast came out. */
  settle(id: string, outcome: ForecastOutcome): void;
}

export interface ResearchDeskOptions {
  store: ResearchStore;
  marketData: Pick<MarketData, "candles">;
  /** Called after a listing's research changes, so whoever shows it can refresh. */
  onChange?: (symbol: SymbolRef) => void;
  now?: () => number;
  createId?: () => string;
}

export type ForecastResult =
  | { ok: true; forecast: Forecast }
  | { ok: false; violations: ForecastViolation[] };

/** Everything research holds of a listing. */
export interface Coverage {
  report: Report | null;
  /** Oldest first. */
  forecasts: Forecast[];
  record: ForecastRecord;
}

/**
 * A listing's research: the report, which holds a view over quarters and is revised, and the
 * forecasts made under it, each frozen once made and scored against what the price then did. The
 * desk stamps what a forecast is measured from itself, its anchor and its report revision, so a
 * forecast cannot choose them. Nothing here reaches an order.
 */
export class ResearchDesk {
  readonly #options: ResearchDeskOptions;

  constructor(options: ResearchDeskOptions) {
    this.#options = options;
  }

  revise(draft: ReportDraft): Revision {
    const { store, now = Date.now } = this.#options;

    const revision = reviseReport(
      store.report(draft.symbol) ?? null,
      draft,
      now()
    );

    if (revision.ok) {
      store.addReport(revision.report);
      this.#options.onChange?.(draft.symbol);
    }

    return revision;
  }

  /**
   * A caller that may run again after a crash passes the same `id` each time, and gets back the
   * forecast already made under it instead of a second one.
   */
  async forecast({
    id,
    ...draft
  }: ForecastDraft & { id?: string }): Promise<ForecastResult> {
    const {
      store,
      marketData,
      now = Date.now,
      createId = () => crypto.randomUUID(),
    } = this.#options;

    const made = id === undefined ? undefined : store.forecast(id);

    if (made) return { ok: true, forecast: made };

    const { instrument } = draft;
    const daily = await marketData.candles(instrument, Interval.OneDay);

    if (daily.length === 0) {
      throw new Error(`${symbolKey(instrument)} has no daily bars`);
    }

    const newest = daily[daily.length - 1];

    const anchor = {
      date: candleDate(instrument.market, newest.time),
      price: newest.close,
    };

    const report = store.report(instrument);

    const violations = checkForecast(draft, {
      anchor,
      stance: report?.stance ?? null,
      taken: store
        .forecasts(instrument)
        .some((forecast) => forecast.anchor.date === anchor.date),
    });

    if (!report || violations.length > 0) return { ok: false, violations };

    const forecast: Forecast = {
      ...draft,
      id: id ?? createId(),
      createdAt: now(),
      anchor,
      reportRevision: report.revision,
      outcome: null,
    };

    store.addForecast(forecast);
    this.#options.onChange?.(instrument);

    return { ok: true, forecast };
  }

  async coverage(symbol: SymbolRef): Promise<Coverage> {
    const { store } = this.#options;
    const forecasts = await this.#settle(symbol, store.forecasts(symbol));

    return {
      report: store.report(symbol) ?? null,
      forecasts,
      record: forecastRecord(forecasts),
    };
  }

  /** How every listing's forecasts have come out. */
  async trackRecord(): Promise<ForecastRecord> {
    const listings = Object.values(
      groupBy(this.#options.store.forecasts(), ({ instrument }) =>
        symbolKey(instrument)
      )
    );

    const settled = await Promise.all(
      listings.map((forecasts) =>
        this.#settle(forecasts[0].instrument, forecasts)
      )
    );

    return forecastRecord(settled.flat());
  }

  /** Judges a listing's forecasts whose horizon has passed and keeps each outcome. */
  async #settle(symbol: SymbolRef, forecasts: Forecast[]): Promise<Forecast[]> {
    const { store, marketData, now = Date.now } = this.#options;

    if (forecasts.every((forecast) => forecast.outcome)) return forecasts;

    let daily: Candle[];

    try {
      daily = await marketData.candles(symbol, Interval.OneDay);
    } catch {
      // Bars can be out of reach, as while no source covers the market; what is kept still reads,
      // and a later read settles it.
      return forecasts;
    }

    const at = new Date(now());

    const judged = forecasts.map((forecast) => {
      const outcome = forecast.outcome ?? judgeForecast(forecast, daily, at);

      if (outcome && !forecast.outcome) store.settle(forecast.id, outcome);

      return { ...forecast, outcome };
    });

    if (
      judged.some(
        (forecast, index) => forecast.outcome !== forecasts[index].outcome
      )
    ) {
      this.#options.onChange?.(symbol);
    }

    return judged;
  }
}
