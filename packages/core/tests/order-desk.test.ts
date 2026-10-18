import { noop } from "es-toolkit";
import { expect, test, vi } from "vite-plus/test";

import { MINUTE_MS } from "@solyx/utils/date";

import { BrokerMode } from "../src/broker.ts";
import type { BrokerAdapter } from "../src/broker.ts";
import { ForecastDirection } from "../src/forecast.ts";
import { Market } from "../src/market.ts";
import {
  OrderDesk,
  ProposalSource,
  ProposalStatus,
  SubmissionFailureCode,
} from "../src/order-desk.ts";
import type {
  OrderDeskOptions,
  ProposalBasis,
  ProposalStore,
  TradeProposal,
} from "../src/order-desk.ts";
import { OrderType, Side } from "../src/order.ts";
import type { AccountSnapshot, OrderRequest } from "../src/order.ts";
import { ReportStance } from "../src/report.ts";
import { RiskViolationCode } from "../src/risk.ts";
import { Session, weekdays } from "../src/session.ts";
import type { TradingDays } from "../src/session.ts";

const order: OrderRequest = {
  instrument: { market: Market.TW, symbol: "2330" },
  side: Side.Buy,
  quantity: 1000,
  type: OrderType.Limit,
  limitPrice: 980,
};

// Copies on the way in and out, like a database would, so the desk cannot lean on shared objects.
function memoryStore(): ProposalStore {
  const proposals = new Map<string, TradeProposal>();

  const save = (proposal: TradeProposal) => {
    proposals.set(proposal.id, structuredClone(proposal));
  };

  return {
    list: () => [...proposals.values()].map((p) => structuredClone(p)),
    get: (id) => structuredClone(proposals.get(id)),
    add: save,
    update: save,
  };
}

const DURING_SESSION = Date.parse("2026-09-29T10:00:00+08:00");

const AFTER_CLOSE = Date.parse("2026-09-29T15:00:00+08:00");

function setup(
  store = memoryStore(),
  {
    restored = false,
    basis,
    priceLimits,
  }: Pick<OrderDeskOptions, "restored" | "basis" | "priceLimits"> = {}
) {
  const clock = { now: DURING_SESSION };
  const tradingDays = vi.fn(async (): Promise<TradingDays> => weekdays);
  const onChange = vi.fn();

  const account: AccountSnapshot = {
    cash: { TWD: 5_000_000 },
    positions: [],
  };

  const getAccount = vi.fn(async () => structuredClone(account));

  const placeOrder = vi
    .fn<BrokerAdapter["placeOrder"]>()
    .mockResolvedValue({ orderId: "B-1" });

  const broker: BrokerAdapter = {
    id: "fake",
    mode: BrokerMode.Paper,
    markets: [Market.TW],
    getAccount,
    placeOrder,
  };

  const desk = new OrderDesk({
    broker,
    store,
    limits: {
      maxOrderNotional: { TWD: 5_000_000, USD: 10_000 },
      allowedSessions: [Session.Regular],
    },
    tradingDays,
    restored,
    basis,
    priceLimits,
    onChange,
    now: () => clock.now,
  });

  return {
    desk,
    placeOrder,
    getAccount,
    account,
    clock,
    tradingDays,
    store,
    onChange,
  };
}

function proposeFromAgent(desk: OrderDesk) {
  return desk.propose({
    order,
    source: ProposalSource.Agent,
    rationale: "test",
  });
}

test("proposing never reaches the broker", async () => {
  const { desk, placeOrder } = setup();
  const proposal = await proposeFromAgent(desk);

  expect(proposal.status).toBe(ProposalStatus.AwaitingConfirmation);
  expect(placeOrder).not.toHaveBeenCalled();
});

test("proposing again under the same id returns the first proposal", async () => {
  const { desk, getAccount, store } = setup();

  const input = {
    id: "call-1",
    order,
    source: ProposalSource.Agent,
    rationale: "test",
  };

  const first = await desk.propose(input);
  const again = await desk.propose(input);

  expect(again).toEqual(first);
  expect(store.list()).toHaveLength(1);
  expect(getAccount).toHaveBeenCalledTimes(1);
});

test("a proposal keeps what research held of its listing as it was made, whoever made it", async () => {
  const held: ProposalBasis = {
    report: {
      revision: 3,
      revisedAt: DURING_SESSION - MINUTE_MS,
      stance: ReportStance.Bullish,
    },
    forecast: {
      id: "f-1",
      createdAt: DURING_SESSION - 30_000,
      direction: ForecastDirection.Long,
      horizon: 5,
    },
  };

  const basis = vi.fn(() => structuredClone(held));
  const { desk, store } = setup(memoryStore(), { basis });

  const agent = await proposeFromAgent(desk);

  const user = await desk.propose({
    order,
    source: ProposalSource.User,
    rationale: "",
  });

  expect(basis).toHaveBeenCalledWith(order.instrument);
  expect(agent.basis).toEqual(held);
  expect(user.basis).toEqual(held);
  expect(store.get(agent.id)?.basis).toEqual(held);
});

test("a desk given no research keeps no basis", async () => {
  const { desk } = setup();

  expect((await proposeFromAgent(desk)).basis).toBeNull();
});

test("confirming submits exactly once", async () => {
  const { desk, placeOrder } = setup();
  const { id } = await proposeFromAgent(desk);

  const [first, second] = await Promise.allSettled([
    desk.confirm(id),
    desk.confirm(id),
  ]);

  expect(first).toMatchObject({
    status: "fulfilled",
    value: { status: ProposalStatus.Submitted },
  });
  expect(second.status).toBe("rejected");
  expect(placeOrder).toHaveBeenCalledTimes(1);
});

test("risk is checked again on confirm", async () => {
  const { desk, placeOrder, clock } = setup();
  const { id } = await proposeFromAgent(desk);

  clock.now = AFTER_CLOSE;

  const confirmed = await desk.confirm(id);

  expect(confirmed.status).toBe(ProposalStatus.Rejected);
  expect(placeOrder).not.toHaveBeenCalled();
});

test("an order on a day the exchange does not trade is checked against a closed session", async () => {
  const { desk, tradingDays } = setup();

  // The session's hours, on a holiday.
  tradingDays.mockResolvedValue(() => false);

  expect(await desk.check(order)).toEqual([
    { code: RiskViolationCode.SessionNotAllowed, session: Session.Closed },
  ]);
});

test("rejected proposals cannot be confirmed", async () => {
  const { desk, placeOrder, clock } = setup();

  clock.now = AFTER_CLOSE;

  const { id, status } = await proposeFromAgent(desk);

  expect(status).toBe(ProposalStatus.Rejected);
  await expect(desk.confirm(id)).rejects.toThrow();
  expect(placeOrder).not.toHaveBeenCalled();
});

test("a broker error is terminal", async () => {
  const { desk, placeOrder } = setup();
  placeOrder.mockRejectedValueOnce(new Error("timeout"));

  const { id } = await desk.propose({
    order,
    source: ProposalSource.User,
    rationale: "test",
  });

  expect(await desk.confirm(id)).toMatchObject({
    status: ProposalStatus.Failed,
    failure: { code: SubmissionFailureCode.Error, message: "timeout" },
  });
  await expect(desk.confirm(id)).rejects.toThrow();
  expect(placeOrder).toHaveBeenCalledTimes(1);
});

test("proposals outlive the desk", async () => {
  const { desk, store } = setup();
  const { id } = await proposeFromAgent(desk);

  const reopened = setup(store);

  expect(reopened.desk.list()).toEqual(desk.list());
  expect(await reopened.desk.confirm(id)).toMatchObject({
    status: ProposalStatus.Submitted,
  });
});

test("a submission cut off by an exit fails and is never resubmitted", async () => {
  const { desk, placeOrder, store } = setup();
  const { id } = await proposeFromAgent(desk);

  // Nothing settles the broker call, as if the app quit while it was out.
  placeOrder.mockReturnValueOnce(new Promise(noop));
  void desk.confirm(id);
  await vi.waitFor(() => expect(placeOrder).toHaveBeenCalledOnce());

  const reopened = setup(store);

  expect(reopened.desk.list()).toMatchObject([
    {
      id,
      status: ProposalStatus.Failed,
      failure: { code: SubmissionFailureCode.Interrupted },
    },
  ]);
  await expect(reopened.desk.confirm(id)).rejects.toThrow();
  expect(reopened.placeOrder).not.toHaveBeenCalled();
});

test("what a desk settles as it opens is told to no one, since nothing shows proposals yet", async () => {
  const { desk, placeOrder, store } = setup();
  const { id } = await proposeFromAgent(desk);

  placeOrder.mockReturnValueOnce(new Promise(noop));
  void desk.confirm(id);
  await vi.waitFor(() => expect(placeOrder).toHaveBeenCalledOnce());
  await proposeFromAgent(desk);

  const reopened = setup(store, { restored: true });

  expect(reopened.desk.list().map(({ status }) => status)).toEqual([
    ProposalStatus.Failed,
    ProposalStatus.Dismissed,
  ]);
  expect(reopened.onChange).not.toHaveBeenCalled();
});

test("a proposal that waited in a backup is dismissed, since it may have been confirmed since", async () => {
  const { desk, store } = setup();
  const waiting = await proposeFromAgent(desk);
  const placed = await proposeFromAgent(desk);

  await desk.confirm(placed.id);

  // Opened again without a restore, what waits still waits.
  expect(setup(store).desk.list()).toEqual(desk.list());

  const restored = setup(store, { restored: true });

  expect(restored.desk.list()).toMatchObject([
    { id: waiting.id, status: ProposalStatus.Dismissed },
    { id: placed.id, status: ProposalStatus.Submitted },
  ]);
  await expect(restored.desk.confirm(waiting.id)).rejects.toThrow();
  expect(restored.placeOrder).not.toHaveBeenCalled();
});

test("what the account cannot pay for or does not hold is rejected, never sent to fail", async () => {
  const { desk, placeOrder, account } = setup();

  account.cash = { TWD: 100_000 };

  const buy = await proposeFromAgent(desk);

  const sale = await desk.propose({
    order: { ...order, side: Side.Sell },
    source: ProposalSource.User,
    rationale: "test",
  });

  expect(buy).toMatchObject({
    status: ProposalStatus.Rejected,
    violations: [{ code: RiskViolationCode.InsufficientCash }],
  });
  expect(sale).toMatchObject({
    status: ProposalStatus.Rejected,
    violations: [{ code: RiskViolationCode.InsufficientShares, held: 0 }],
  });
  expect(placeOrder).not.toHaveBeenCalled();
});

test("a market the broker does not trade is rejected", async () => {
  const { desk } = setup();

  const proposal = await desk.propose({
    order: {
      ...order,
      instrument: {
        market: Market.US,
        symbol: "AAPL",
      },
      quantity: 10,
      limitPrice: 230,
    },
    source: ProposalSource.Agent,
    rationale: "test",
  });

  expect(proposal.violations).toContainEqual({
    code: RiskViolationCode.UnsupportedMarket,
    market: Market.US,
  });
});

test("every change to a proposal is told, its submission included", async () => {
  const { desk, onChange } = setup();
  const { id } = await proposeFromAgent(desk);
  const other = await proposeFromAgent(desk);

  expect(onChange).toHaveBeenCalledTimes(2);

  await desk.confirm(id);

  // Once as it starts submitting, once as the broker answers.
  expect(onChange).toHaveBeenCalledTimes(4);

  desk.dismiss(other.id);

  expect(onChange).toHaveBeenCalledTimes(5);
});

test("an order is checked against the limits its exchange set for the session it goes to", async () => {
  const priceLimits = vi.fn(async () => ({
    after: "2026-09-28",
    band: { low: 882, high: 970 },
  }));

  const { desk, clock } = setup(undefined, { priceLimits });

  expect(await desk.check(order)).toEqual([
    { code: RiskViolationCode.OutsidePriceBand, low: 882, high: 970 },
  ]);
  expect(priceLimits).toHaveBeenCalledWith(order.instrument);

  // After the close the order goes to the next session, whose limits are not out yet.
  clock.now = AFTER_CLOSE;

  expect(await desk.check(order)).toEqual([
    { code: RiskViolationCode.SessionNotAllowed, session: Session.Closed },
  ]);
});

test("a market order is sized at the session's limit-up, and refused while it is not known", async () => {
  const market: OrderRequest = {
    instrument: order.instrument,
    side: Side.Buy,
    quantity: 1000,
    type: OrderType.Market,
  };

  const { desk } = setup(undefined, {
    priceLimits: async () => ({
      after: "2026-09-28",
      band: { low: 882, high: 1070 },
    }),
  });

  expect(await desk.check(market)).toEqual([]);

  const { desk: unknown } = setup();

  expect(await unknown.check(market)).toEqual([
    { code: RiskViolationCode.MissingReferencePrice },
  ]);
});
