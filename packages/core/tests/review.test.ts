import { expect, test } from "vite-plus/test";

import { Market } from "../src/market.ts";
import { ProposalSource, ProposalStatus } from "../src/order-desk.ts";
import type { ProposalBasis, TradeProposal } from "../src/order-desk.ts";
import { OrderType, Side } from "../src/order.ts";
import type { Fill } from "../src/order.ts";
import { ReportStance } from "../src/report.ts";
import { recordsByStance, roundTrips, tradeRecord } from "../src/review.ts";
import type { RoundTrip } from "../src/review.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const APPLE = { market: Market.US, symbol: "AAPL" };

const fill = (
  orderId: string,
  side: Side,
  quantity: number,
  filledAt: number,
  realized: number | null = null,
  instrument = TSMC
): Fill => ({
  orderId,
  instrument,
  side,
  quantity,
  price: 1000,
  filledAt,
  realized,
});

const basis = (stance: ReportStance): ProposalBasis => ({
  report: { revision: 1, revisedAt: 0, stance },
  forecast: null,
});

const submitted = (
  brokerOrderId: string,
  proposalBasis: ProposalBasis | null
): TradeProposal => ({
  id: `p-${brokerOrderId}`,
  order: {
    instrument: TSMC,
    side: Side.Buy,
    quantity: 1000,
    type: OrderType.Limit,
    limitPrice: 1000,
  },
  source: ProposalSource.Agent,
  rationale: "test",
  basis: proposalBasis,
  createdAt: 0,
  status: ProposalStatus.Submitted,
  violations: [],
  brokerOrderId,
});

test("a round trip runs from the buy that opens a position to the sale that leaves none, under its first buy's research", () => {
  const fills = [
    fill("B-1", Side.Buy, 1000, 1),
    fill("B-2", Side.Buy, 1000, 2),
    fill("B-3", Side.Sell, 1500, 3, 30_000),
    fill("B-4", Side.Sell, 500, 4, -2_000),
    // Opened again, and still open.
    fill("B-5", Side.Buy, 1000, 5),
  ];

  expect(
    roundTrips(fills, [
      submitted("B-1", basis(ReportStance.Bullish)),
      submitted("B-2", basis(ReportStance.Bearish)),
    ])
  ).toEqual([
    {
      instrument: TSMC,
      openedAt: 1,
      closedAt: 4,
      realized: 28_000,
      stance: ReportStance.Bullish,
    },
  ]);
});

test("a buy no proposal names, or one made with no report, opens a trip under none", () => {
  const fills = [
    fill("B-1", Side.Buy, 1000, 1),
    fill("B-2", Side.Sell, 1000, 2, 5_000),
    fill("B-3", Side.Buy, 1000, 3),
    fill("B-4", Side.Sell, 1000, 4, 5_000),
  ];

  expect(
    roundTrips(fills, [submitted("B-3", null)]).map(({ stance }) => stance)
  ).toEqual([null, null]);
});

test("a sale of shares held before the fills began opens nothing", () => {
  expect(roundTrips([fill("B-1", Side.Sell, 1000, 1, 10_000)], [])).toEqual([]);
});

const trip = (realized: number, stance: ReportStance | null = null) =>
  ({
    instrument: TSMC,
    openedAt: 0,
    closedAt: 1,
    realized,
    stance,
  }) satisfies RoundTrip;

test("a record weighs the average win against the average loss", () => {
  expect(
    tradeRecord([trip(30_000), trip(10_000), trip(-10_000), trip(0)])
  ).toEqual({
    trips: 4,
    wins: 2,
    losses: 1,
    winRate: 0.5,
    averageWin: 20_000,
    averageLoss: -10_000,
    payoffRatio: 2,
    realized: 30_000,
  });
  expect(tradeRecord([])).toMatchObject({
    winRate: null,
    payoffRatio: null,
    realized: 0,
  });
});

test("records go by currency, then by the stance trips were opened under, none where it opened none", () => {
  const records = recordsByStance([
    trip(10_000, ReportStance.Bullish),
    trip(-5_000, null),
    trip(-5_000, ReportStance.Bullish),
    { ...trip(300), instrument: APPLE },
  ]);

  expect(
    records.map(({ currency, all, stances }) => ({
      currency,
      trips: all.trips,
      stances: stances.map(({ stance, record }) => [stance, record.trips]),
    }))
  ).toEqual([
    {
      currency: "TWD",
      trips: 3,
      stances: [
        [ReportStance.Bullish, 2],
        [null, 1],
      ],
    },
    { currency: "USD", trips: 1, stances: [[null, 1]] },
  ]);
});
