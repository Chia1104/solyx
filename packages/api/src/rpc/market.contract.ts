import { asyncIteratorObject, oc, type } from "@orpc/contract";
import * as z from "zod";

import { intervalSchema } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { marketSchema, symbolRefSchema } from "@solyx/core/market";
import type { Market } from "@solyx/core/market";
import type { Depth, Listing } from "@solyx/core/market-data";
import type { SessionQuote } from "@solyx/core/quote";
import type { PriceBand } from "@solyx/core/risk";
import {
  MAX_ROTATION_LISTINGS,
  rotationAgainstSchema,
} from "@solyx/core/rotation";
import type {
  ListingHistory,
  RotationHistory,
  SectorHistory,
} from "@solyx/core/rotation";
import type { SectorQuote } from "@solyx/core/sectors";
import type { Session } from "@solyx/core/session";

import type {
  CandleSet,
  ListingMatch,
  ListingRotationView,
} from "../market.ts";

import { forDevices } from "./access.ts";
import { changesContract } from "./changes.ts";

const seriesSchema = z.object({
  symbol: symbolRefSchema,
  interval: intervalSchema,
});

export const marketContract = {
  sessions: oc.meta(forDevices(true)).output(type<Record<Market, Session>>()),
  /** `null` when no source covers the market or the source does not list the symbol. */
  listing: oc
    .meta(forDevices(true))
    .input(symbolRefSchema)
    .output(type<Listing | null>()),
  /**
   * Listings whose code or name matches `query`, best first, in `market` or in every market where
   * it is `null`. US listings are found once their source is signed in.
   */
  search: oc
    .meta(forDevices(true))
    .input(
      z.object({
        query: z.string().trim().min(1).max(40),
        market: marketSchema.nullable(),
      })
    )
    .output(type<ListingMatch[]>()),
  /**
   * Bars oldest first: the interval's lookback window, or with `before` the page of history
   * before the bar opening then, which is empty once the source has nothing older.
   */
  candles: oc
    .meta(forDevices(true))
    .input(seriesSchema.extend({ before: z.number().optional() }))
    .output(type<CandleSet>()),
  /**
   * The newest session's five-minute line against the close before it; `null` when no source
   * covers the market or the source has no bars for the symbol. It takes no stream slot.
   */
  quote: oc
    .meta(forDevices(true))
    .input(symbolRefSchema)
    .output(type<SessionQuote | null>()),
  /** Every Taiwan sector index's session so far, one request each; `null` when no source covers Taiwan. */
  sectors: oc.meta(forDevices(true)).output(type<SectorQuote[] | null>()),
  /**
   * Every Taiwan sector index's rotation against the TAIEX across the sessions it may be played
   * back over, daily-bar requests each: once, or over the newest year and then whole where the
   * older years must come from the source. `null` when no source covers Taiwan.
   */
  rotations: oc
    .meta(forDevices(true))
    .input(
      z.object({
        /** A TWSE listing or index to read the sectors against in the TAIEX's place; rejects one that does not qualify. */
        benchmark: symbolRefSchema.optional(),
      })
    )
    .output(asyncIteratorObject(type<RotationHistory<SectorHistory> | null>())),
  /** Each listing's rotation on adjusted bars across the sessions it may be played back over, read as the sectors' are; rejects while no source covers a market. */
  listingRotations: oc
    .meta(forDevices(true))
    .input(
      z.object({
        symbols: z.array(symbolRefSchema).max(MAX_ROTATION_LISTINGS),
        benchmark: symbolRefSchema.optional(),
        against: rotationAgainstSchema.optional(),
      })
    )
    .output(asyncIteratorObject(type<RotationHistory<ListingHistory>>())),
  /** One listing against its market's index and, for a TWSE company in an industry with an index, against that index too. */
  listingRotation: oc
    .meta(forDevices(true))
    .input(symbolRefSchema)
    .output(type<ListingRotationView>()),
  /**
   * Today's bars of the series as they form, a batch at a time, each bar replacing the one with
   * the same time: an empty batch first once a live stream covers the symbol, and none, with the
   * end at once, when none does. The symbol is watched until the window stops reading.
   */
  liveCandles: oc
    .meta(forDevices(true))
    .input(seriesSchema)
    .output(asyncIteratorObject(type<Candle[]>())),
  /**
   * The listing's depth as it changes: where it stands first, `null` when no source covers the
   * market or the source keeps no book for the symbol, then each change, pushed by the live stream
   * where it takes the symbol and read every few seconds through the regular session where not.
   */
  depth: oc
    .meta(forDevices(true))
    .input(symbolRefSchema)
    .output(asyncIteratorObject(type<Depth | null>())),
  /**
   * The prices the listing may trade between in the session an order placed now goes to; `null`
   * where it trades without limits or the exchange's list for that session is not out or not read.
   */
  band: oc
    .meta(forDevices(true))
    .input(symbolRefSchema)
    .output(type<PriceBand | null>()),
  /** Where some market's bars come from changed, by the settings page or a hand edit: load and watch again. */
  sourceChanges: changesContract,
};
