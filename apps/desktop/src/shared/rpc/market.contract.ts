import { asyncIteratorObject, oc, type } from "@orpc/contract";
import * as z from "zod";

import { intervalSchema } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { symbolRefSchema } from "@solyx/core/market";
import type { Market } from "@solyx/core/market";
import type { Depth, Listing } from "@solyx/core/market-data";
import type { SessionQuote } from "@solyx/core/quote";
import type { PriceBand } from "@solyx/core/risk";
import { MAX_ROTATION_LISTINGS } from "@solyx/core/rotation";
import type { ListingRotation, SectorRotation } from "@solyx/core/rotation";
import type { SectorQuote } from "@solyx/core/sectors";
import type { Session } from "@solyx/core/session";

import type { CandleSet } from "../market.ts";

import { changesContract } from "./changes.ts";

const seriesSchema = z.object({
  symbol: symbolRefSchema,
  interval: intervalSchema,
});

export const marketContract = {
  sessions: oc.output(type<Record<Market, Session>>()),
  /** `null` when no source covers the market or the source does not list the symbol. */
  listing: oc.input(symbolRefSchema).output(type<Listing | null>()),
  /**
   * Bars oldest first: the interval's lookback window, or with `before` the page of history
   * before the bar opening then, which is empty once the source has nothing older.
   */
  candles: oc
    .input(seriesSchema.extend({ before: z.number().optional() }))
    .output(type<CandleSet>()),
  /**
   * The newest session's five-minute line against the close before it; `null` when no source
   * covers the market or the source has no bars for the symbol. It takes no stream slot.
   */
  quote: oc.input(symbolRefSchema).output(type<SessionQuote | null>()),
  /** Every Taiwan sector index's session so far, one request each; `null` when no source covers Taiwan. */
  sectors: oc.output(type<SectorQuote[] | null>()),
  /** Every Taiwan sector index's rotation against the TAIEX, a daily-bar request each; `null` when no source covers Taiwan. */
  rotations: oc.output(type<SectorRotation[] | null>()),
  /** Each listing's rotation against its market's index on adjusted bars, a daily-bar request each; rejects while no source covers a market. */
  listingRotations: oc
    .input(z.array(symbolRefSchema).max(MAX_ROTATION_LISTINGS))
    .output(type<ListingRotation[]>()),
  /**
   * Today's bars of the series as they form, a batch at a time, each bar replacing the one with
   * the same time: an empty batch first once a live stream covers the symbol, and none, with the
   * end at once, when none does. The symbol is watched until the window stops reading.
   */
  liveCandles: oc
    .input(seriesSchema)
    .output(asyncIteratorObject(type<Candle[]>())),
  /**
   * The listing's depth as it changes: where it stands first, `null` when no source covers the
   * market or the source keeps no book for the symbol, then each change, pushed by the live stream
   * where it takes the symbol and read every few seconds through the regular session where not.
   */
  depth: oc
    .input(symbolRefSchema)
    .output(asyncIteratorObject(type<Depth | null>())),
  /**
   * The prices the listing may trade between in the session an order placed now goes to; `null`
   * where it trades without limits or the exchange's list for that session is not out or not read.
   */
  band: oc.input(symbolRefSchema).output(type<PriceBand | null>()),
  /** Where some market's bars come from changed, by the settings page or a hand edit: load and watch again. */
  sourceChanges: changesContract,
};
