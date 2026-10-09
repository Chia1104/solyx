import { groupBy, keyBy } from "es-toolkit";

import { Interval, candleDate } from "./candles.ts";
import type { Candle } from "./candles.ts";
import type { Council } from "./council.ts";
import {
  ForecastViolationCode,
  checkForecast,
  forecastRecord,
  judgeForecast,
} from "./forecast.ts";
import type {
  Forecast,
  ForecastAnchor,
  ForecastDraft,
  ForecastOutcome,
  ForecastRecord,
  ForecastViolation,
} from "./forecast.ts";
import type { Fundamentals } from "./fundamentals.ts";
import type { MarketData } from "./market-data.ts";
import { symbolKey } from "./market.ts";
import type { SymbolRef } from "./market.ts";
import { reviseReport } from "./report.ts";
import type {
  Claim,
  ClaimAuditor,
  ClaimSupport,
  Report,
  ReportDraft,
  Revision,
} from "./report.ts";

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
  /**
   * Up to `limit` listings' reports holding any word of `query`, best first: of each listing, its
   * newest revision that holds one. `symbol` keeps to that listing.
   */
  searchReports(query: string, limit: number, symbol?: SymbolRef): Report[];
  /** Up to `limit` forecasts holding any word of `query`, best first; `symbol` keeps to that listing. */
  searchForecasts(query: string, limit: number, symbol?: SymbolRef): Forecast[];
}

export interface ResearchDeskOptions {
  store: ResearchStore;
  marketData: Pick<MarketData, "candles">;
  fundamentals: Pick<Fundamentals, "statements">;
  /** Reads each claim against its quote as it is kept; none until the user sets up a decisions model. */
  auditor?: () => Promise<ClaimAuditor | undefined>;
  /** Called after a listing's research changes, so whoever shows it can refresh. */
  onChange?: (symbol: SymbolRef) => void;
  now?: () => number;
  createId?: () => string;
}

/** A forecast that passed every check, as it is put to a vote before it is kept. */
export interface ForecastMotion {
  draft: ForecastDraft;
  anchor: ForecastAnchor;
  report: Report;
}

/** Puts a forecast to a vote; the desk keeps it only when the vote carries it. */
export type Ratify = (motion: ForecastMotion) => Promise<Council>;

/** How every listing's forecasts have come out, and those a vote carried among them. */
export interface TrackRecord {
  all: ForecastRecord;
  ratified: ForecastRecord;
}

export type ForecastResult =
  | { ok: true; forecast: Forecast }
  | { ok: false; violations: ForecastViolation[] };

/** Everything research holds of a listing. */
export interface Coverage {
  report: Report | null;
  /** The last day of a quarter published since the report was revised, which it must take in before the next forecast; `null` when it is current. */
  newerFinancials: string | null;
  /** Oldest first. */
  forecasts: Forecast[];
  record: ForecastRecord;
}

/** A report revision a search found. */
export interface ReportMatch {
  report: Report;
  /** The listing's newest revision, which is the one in force. */
  newest: number;
}

/** What a search found of every listing's research, best first. */
export interface ResearchMatches {
  reports: ReportMatch[];
  forecasts: Forecast[];
}

/** The quarter that makes a report stale: one newer than the newest it was revised with. */
function newerFinancials(report: Report, newest: string | null) {
  return newest !== null && report.financialsThrough !== newest ? newest : null;
}

/**
 * A listing's research: the report, which holds a view over quarters and is revised, and the
 * forecasts made under it, each frozen once made and scored against what the price then did. The
 * desk stamps what a forecast is measured from itself, its anchor and its report revision, so a
 * forecast cannot choose them, and a report with the newest quarter public when it was revised, so
 * a forecast is refused once a newer one is out. Nothing here reaches an order.
 */
export class ResearchDesk {
  readonly #options: ResearchDeskOptions;

  constructor(options: ResearchDeskOptions) {
    this.#options = options;
  }

  async revise(draft: ReportDraft): Promise<Revision> {
    const { store, now = Date.now } = this.#options;
    const financialsThrough = await this.#newestQuarter(draft.symbol);

    const support = await this.#audit([
      ...(draft.drivers ?? []),
      ...(draft.risks ?? []),
    ]);

    const revision = reviseReport(store.report(draft.symbol) ?? null, draft, {
      at: now(),
      financialsThrough,
      support,
    });

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
  async forecast(
    { id, ...draft }: ForecastDraft & { id?: string },
    /** Asked only of a forecast that passed every check, so no vote is spent on one that would be refused. */
    ratify?: Ratify
  ): Promise<ForecastResult> {
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

    const newestQuarter = await this.#newestQuarter(instrument);
    const support = await this.#audit(draft.claims);

    // Reads the store afresh each time, since a vote leaves room for another forecast to be kept.
    const check = () => {
      const report = store.report(instrument);

      const violations = checkForecast(draft, {
        anchor,
        stance: report?.stance ?? null,
        newerFinancials: report ? newerFinancials(report, newestQuarter) : null,
        taken: store
          .forecasts(instrument)
          .some((forecast) => forecast.anchor.date === anchor.date),
        support,
      });

      return { report, violations };
    };

    let { report, violations } = check();

    if (!report || violations.length > 0) return { ok: false, violations };

    let council: Council | null = null;

    if (ratify) {
      council = await ratify({ draft, anchor, report });

      if (!council.carried) {
        return {
          ok: false,
          violations: [{ code: ForecastViolationCode.MotionRejected, council }],
        };
      }

      ({ report, violations } = check());

      if (!report || violations.length > 0) return { ok: false, violations };
    }

    const forecast: Forecast = {
      ...draft,
      claims: draft.claims.map((claim) => ({
        ...claim,
        support: support(claim),
      })),
      id: id ?? createId(),
      createdAt: now(),
      anchor,
      reportRevision: report.revision,
      council,
      outcome: null,
    };

    store.addForecast(forecast);
    this.#options.onChange?.(instrument);

    return { ok: true, forecast };
  }

  async coverage(symbol: SymbolRef): Promise<Coverage> {
    const { store } = this.#options;
    const forecasts = await this.#settle(symbol, store.forecasts(symbol));
    const report = store.report(symbol) ?? null;

    return {
      report,
      newerFinancials: report
        ? newerFinancials(report, await this.#newestQuarter(symbol))
        : null,
      forecasts,
      record: forecastRecord(forecasts),
    };
  }

  async trackRecord(): Promise<TrackRecord> {
    const listings = Object.values(
      groupBy(this.#options.store.forecasts(), ({ instrument }) =>
        symbolKey(instrument)
      )
    );

    const settled = (
      await Promise.all(
        listings.map((forecasts) =>
          this.#settle(forecasts[0].instrument, forecasts)
        )
      )
    ).flat();

    return {
      all: forecastRecord(settled),
      ratified: forecastRecord(settled.filter((forecast) => forecast.council)),
    };
  }

  /**
   * Up to `limit` reports and `limit` forecasts holding any word of `query`, as the store finds
   * them, each forecast past its horizon settled as `coverage` settles it.
   */
  async search(
    query: string,
    limit: number,
    symbol?: SymbolRef
  ): Promise<ResearchMatches> {
    const { store } = this.#options;
    const found = store.searchForecasts(query, limit, symbol);

    const settled = keyBy(
      (
        await Promise.all(
          Object.values(
            groupBy(found, ({ instrument }) => symbolKey(instrument))
          ).map((forecasts) => this.#settle(forecasts[0].instrument, forecasts))
        )
      ).flat(),
      (forecast) => forecast.id
    );

    return {
      reports: store.searchReports(query, limit, symbol).map((report) => ({
        report,
        newest: store.report(report.symbol)?.revision ?? report.revision,
      })),
      forecasts: found.map((forecast) => settled[forecast.id] ?? forecast),
    };
  }

  /** Has each claim read against its quote, and answers with the reading a claim was given. */
  async #audit(
    claims: readonly Claim[]
  ): Promise<(claim: Claim) => ClaimSupport | null> {
    const auditor = await this.#options.auditor?.();

    const readings = await Promise.all(
      claims.map(async (claim) =>
        // A claim is kept unread rather than lost when the model cannot be reached.
        auditor ? auditor.audit(claim).catch(() => null) : null
      )
    );

    return (claim) => readings[claims.indexOf(claim)] ?? null;
  }

  /** The last day of the newest quarter public for a listing; `null` when none is. */
  async #newestQuarter(symbol: SymbolRef): Promise<string | null> {
    try {
      const statements = await this.#options.fundamentals.statements(symbol);

      return statements.at(-1)?.periodEnd ?? null;
    } catch {
      // Fundamentals can be out of reach; research goes on without knowing of a newer quarter.
      return null;
    }
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
