import { noop } from "es-toolkit";
import { expect, test, vi } from "vite-plus/test";

import { DAY_MS, MINUTE_MS } from "@solyx/utils/date";

import {
  BrokerMode,
  BrokerOrderStatus,
  OrderRefusedError,
  orderTag,
} from "../src/broker.ts";
import type { BrokerAdapter, BrokerOrder } from "../src/broker.ts";
import { ForecastDirection } from "../src/forecast.ts";
import { MandateViolationCode } from "../src/mandate.ts";
import type { Mandate } from "../src/mandate.ts";
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
import type { AccountSnapshot, Fill, OrderRequest } from "../src/order.ts";
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
    locked,
    maxDailyLoss,
    lastPrice,
    mandate,
    brokerId = "fake",
  }: Pick<
    OrderDeskOptions,
    | "restored"
    | "basis"
    | "priceLimits"
    | "locked"
    | "maxDailyLoss"
    | "lastPrice"
    | "mandate"
  > & { brokerId?: string } = {}
) {
  const clock = { now: DURING_SESSION };
  const tradingDays = vi.fn(async (): Promise<TradingDays> => weekdays);
  const onChange = vi.fn();
  const lockOrders = vi.fn();

  const account: AccountSnapshot = {
    cash: { TWD: 5_000_000 },
    positions: [],
  };

  const getAccount = vi.fn(async () => structuredClone(account));

  const placeOrder = vi
    .fn<BrokerAdapter["placeOrder"]>()
    .mockResolvedValue({ orderId: "B-1" });

  const getFills = vi.fn<BrokerAdapter["getFills"]>(async () => []);
  const getOrders = vi.fn<BrokerAdapter["getOrders"]>(async () => []);

  const cancelOrder = vi.fn<BrokerAdapter["cancelOrder"]>(
    async () => undefined
  );

  const broker: BrokerAdapter = {
    id: brokerId,
    mode: BrokerMode.Paper,
    markets: [Market.TW],
    getAccount,
    getFills,
    getOrders,
    placeOrder,
    cancelOrder,
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
    locked,
    maxDailyLoss,
    lastPrice,
    mandate,
    lockOrders,
    onChange,
    now: () => clock.now,
  });

  return {
    desk,
    placeOrder,
    getAccount,
    getFills,
    getOrders,
    cancelOrder,
    account,
    clock,
    tradingDays,
    store,
    onChange,
    lockOrders,
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

test("a broker error leaves the outcome unknown, and is terminal", async () => {
  const { desk, placeOrder } = setup();
  placeOrder.mockRejectedValueOnce(new Error("timeout"));

  const { id } = await desk.propose({
    order,
    source: ProposalSource.User,
    rationale: "test",
  });

  expect(await desk.confirm(id)).toMatchObject({
    status: ProposalStatus.Failed,
    failure: { code: SubmissionFailureCode.Unknown, message: "timeout" },
  });
  await expect(desk.confirm(id)).rejects.toThrow();
  expect(placeOrder).toHaveBeenCalledTimes(1);
});

test("a broker's refusal says nothing was placed, and is terminal too", async () => {
  const { desk, placeOrder } = setup();
  placeOrder.mockRejectedValueOnce(new OrderRefusedError("not enough cash"));

  const { id } = await proposeFromAgent(desk);

  expect(await desk.confirm(id)).toMatchObject({
    status: ProposalStatus.Failed,
    failure: {
      code: SubmissionFailureCode.Refused,
      message: "not enough cash",
    },
  });
  await expect(desk.confirm(id)).rejects.toThrow();
});

function brokerOrder(
  proposalId: string,
  overrides: Partial<BrokerOrder> = {}
): BrokerOrder {
  return {
    id: "B-9",
    tag: orderTag(proposalId),
    order,
    filled: 0,
    status: BrokerOrderStatus.Working,
    placedAt: DURING_SESSION,
    ...overrides,
  };
}

test("an order goes to the broker marked with its proposal's tag", async () => {
  const { desk, placeOrder } = setup();
  const { id } = await proposeFromAgent(desk);

  await desk.confirm(id);

  expect(placeOrder).toHaveBeenCalledWith(order, orderTag(id));
});

test("an order whose sending failed unanswered is found by its tag and kept as submitted", async () => {
  const { desk, placeOrder, getOrders } = setup();
  const { id } = await proposeFromAgent(desk);

  placeOrder.mockRejectedValueOnce(new Error("timeout"));
  getOrders.mockResolvedValue([
    brokerOrder("someone else's", { id: "B-8" }),
    brokerOrder(id),
  ]);

  expect(await desk.confirm(id)).toMatchObject({
    status: ProposalStatus.Failed,
    failure: { code: SubmissionFailureCode.Unknown },
  });

  await vi.waitFor(() =>
    expect(desk.list()).toEqual([
      expect.objectContaining({
        id,
        status: ProposalStatus.Submitted,
        brokerOrderId: "B-9",
      }),
    ])
  );
  expect(desk.list()[0]).not.toHaveProperty("failure");
  expect(placeOrder).toHaveBeenCalledTimes(1);
});

test("an order the broker does not list stays unknown until its session is over, then failed for good", async () => {
  const { desk, placeOrder, getOrders, clock } = setup();
  const { id } = await proposeFromAgent(desk);

  placeOrder.mockRejectedValueOnce(new Error("timeout"));
  await desk.confirm(id);
  await desk.reconcile();

  expect(desk.list()).toMatchObject([
    { failure: { code: SubmissionFailureCode.Unknown } },
  ]);

  clock.now = AFTER_CLOSE;
  await desk.reconcile();

  expect(getOrders).toHaveBeenLastCalledWith(desk.list()[0]?.createdAt);
  expect(desk.list()).toMatchObject([
    {
      status: ProposalStatus.Failed,
      failure: { code: SubmissionFailureCode.Absent },
    },
  ]);

  // Failed for good: nothing is read for it again.
  getOrders.mockClear();
  await desk.reconcile();
  expect(getOrders).not.toHaveBeenCalled();
});

test("a change the broker tells of refreshes the account and finds an unanswered order", async () => {
  const { desk, placeOrder, getOrders, onChange } = setup();
  const { id } = await proposeFromAgent(desk);

  placeOrder.mockRejectedValueOnce(new Error("timeout"));
  await desk.confirm(id);
  await desk.reconcile();

  onChange.mockClear();
  getOrders.mockResolvedValue([brokerOrder(id)]);

  await desk.brokerChanged();

  expect(onChange).toHaveBeenCalled();
  expect(desk.list()).toMatchObject([
    { id, status: ProposalStatus.Submitted, brokerOrderId: "B-9" },
  ]);
});

test("a submission an exit cut off is found by its tag once the desk reconciles", async () => {
  const { desk, placeOrder, store } = setup();
  const { id } = await proposeFromAgent(desk);

  placeOrder.mockReturnValueOnce(new Promise(noop));
  void desk.confirm(id);
  await vi.waitFor(() =>
    expect(desk.list()).toMatchObject([{ status: ProposalStatus.Submitting }])
  );

  const reopened = setup(store);
  reopened.getOrders.mockResolvedValue([brokerOrder(id)]);

  expect(reopened.desk.list()).toMatchObject([
    { failure: { code: SubmissionFailureCode.Interrupted } },
  ]);

  await reopened.desk.reconcile();

  expect(reopened.desk.list()).toMatchObject([
    { status: ProposalStatus.Submitted, brokerOrderId: "B-9" },
  ]);
});

test("a refused order is never looked for, since the broker holds nothing of it", async () => {
  const { desk, placeOrder, getOrders } = setup();
  const { id } = await proposeFromAgent(desk);

  placeOrder.mockRejectedValueOnce(new OrderRefusedError("not enough cash"));
  await desk.confirm(id);
  await desk.reconcile();

  expect(getOrders).not.toHaveBeenCalled();
});

test("working orders are the market day's that may still fill", async () => {
  const { desk, getOrders } = setup();

  getOrders.mockResolvedValue([
    brokerOrder("a", { id: "B-1", status: BrokerOrderStatus.Pending }),
    brokerOrder("b", { id: "B-2", status: BrokerOrderStatus.Working }),
    brokerOrder("c", { id: "B-3", status: BrokerOrderStatus.Filled }),
    brokerOrder("d", { id: "B-4", status: BrokerOrderStatus.Cancelled }),
    brokerOrder("e", { id: "B-5", status: BrokerOrderStatus.Refused }),
  ]);

  expect((await desk.working()).map(({ id }) => id)).toEqual(["B-1", "B-2"]);
  expect(getOrders).toHaveBeenCalledWith(
    Date.parse("2026-09-29T00:00:00+08:00")
  );
});

test("a check that fails sends nothing, so the proposal waits for the user again", async () => {
  const { desk, placeOrder, getAccount } = setup();
  const { id } = await proposeFromAgent(desk);

  getAccount.mockRejectedValueOnce(new Error("account unreadable"));

  await expect(desk.confirm(id)).rejects.toThrow("account unreadable");
  expect(placeOrder).not.toHaveBeenCalled();
  expect(desk.list()).toMatchObject([
    { id, status: ProposalStatus.AwaitingConfirmation },
  ]);

  expect(await desk.confirm(id)).toMatchObject({
    status: ProposalStatus.Submitted,
  });
});

test("an exit while the proposal is checked again leaves it waiting, since nothing was sent", async () => {
  const { desk, placeOrder, getAccount, store } = setup();
  const { id } = await proposeFromAgent(desk);

  // Nothing settles the check, as if the app quit while it read the account.
  getAccount.mockReturnValueOnce(new Promise(noop));
  void desk.confirm(id);
  await vi.waitFor(() =>
    expect(desk.list()).toMatchObject([{ status: ProposalStatus.Confirming }])
  );

  expect(setup(store).desk.list()).toMatchObject([
    { id, status: ProposalStatus.AwaitingConfirmation },
  ]);
  expect(placeOrder).not.toHaveBeenCalled();
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

test("a proposal is made for the desk's broker, and one waiting for another is dismissed as a desk opens on this one", async () => {
  const { desk, store } = setup();
  const waiting = await proposeFromAgent(desk);

  expect(waiting.broker).toBe("fake");

  const elsewhere = setup(store, { brokerId: "other" });

  expect(elsewhere.desk.list()).toMatchObject([
    { id: waiting.id, broker: "fake", status: ProposalStatus.Dismissed },
  ]);
  await expect(elsewhere.desk.confirm(waiting.id)).rejects.toThrow();
  expect(elsewhere.placeOrder).not.toHaveBeenCalled();
});

test("a desk looks for no order of a proposal it did not send", async () => {
  const { desk, placeOrder, store } = setup();
  const { id } = await proposeFromAgent(desk);

  placeOrder.mockRejectedValueOnce(new Error("timeout"));
  await desk.confirm(id);

  const elsewhere = setup(store, { brokerId: "other" });

  elsewhere.getOrders.mockResolvedValue([brokerOrder(id)]);
  await elsewhere.desk.reconcile();

  expect(elsewhere.getOrders).not.toHaveBeenCalled();
  expect(elsewhere.desk.list()).toMatchObject([
    { failure: { code: SubmissionFailureCode.Unknown } },
  ]);
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

  // As it is checked again, as it is sent and as the broker answers.
  expect(onChange).toHaveBeenCalledTimes(5);

  desk.dismiss(other.id);

  expect(onChange).toHaveBeenCalledTimes(6);
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

test("a lock refuses new proposals and keeps those waiting from being sent, read at every check", async () => {
  const lock = { on: false };
  const { desk, placeOrder } = setup(undefined, { locked: () => lock.on });
  const waiting = await proposeFromAgent(desk);

  lock.on = true;

  expect(await proposeFromAgent(desk)).toMatchObject({
    status: ProposalStatus.Rejected,
    violations: [{ code: RiskViolationCode.OrdersLocked }],
  });
  expect(await desk.confirm(waiting.id)).toMatchObject({
    status: ProposalStatus.Rejected,
    violations: [{ code: RiskViolationCode.OrdersLocked }],
  });
  expect(placeOrder).not.toHaveBeenCalled();
});

test("a buy is refused once the day's sales have lost the user's limit, which the broker's fills tell", async () => {
  const { desk, getFills } = setup(undefined, {
    maxDailyLoss: () => ({ TWD: 50_000 }),
  });

  getFills.mockResolvedValue([
    {
      orderId: "B-0",
      instrument: order.instrument,
      side: Side.Sell,
      quantity: 1000,
      price: 930,
      filledAt: DURING_SESSION - MINUTE_MS,
      realized: -60_000,
    },
  ]);

  expect(await desk.check(order)).toEqual([
    {
      code: RiskViolationCode.DailyLossReached,
      loss: 60_000,
      max: 50_000,
      currency: "TWD",
    },
  ]);
  // From the start of the market's day.
  expect(getFills).toHaveBeenCalledExactlyOnceWith(
    Date.parse("2026-09-29T00:00:00+08:00")
  );

  // A sale needs no fills read, and a market without a limit none either.
  getFills.mockClear();
  await desk.check({ ...order, side: Side.Sell });
  await desk.check({
    ...order,
    instrument: { market: Market.US, symbol: "AAPL" },
  });

  expect(getFills).not.toHaveBeenCalled();
});

test("a buy waits while a sale of the day's has yet to be reckoned, and a sale still goes", async () => {
  const { desk, getFills } = setup(undefined, {
    maxDailyLoss: () => ({ TWD: 50_000 }),
  });

  getFills.mockResolvedValue([
    {
      orderId: "B-0",
      instrument: order.instrument,
      side: Side.Sell,
      quantity: 1000,
      price: 930,
      filledAt: DURING_SESSION - MINUTE_MS,
      realized: null,
    },
  ]);

  expect(await desk.check(order)).toEqual([
    { code: RiskViolationCode.DailyLossUnknown, max: 50_000, currency: "TWD" },
  ]);
  expect(await desk.check({ ...order, side: Side.Sell })).not.toContainEqual(
    expect.objectContaining({ code: RiskViolationCode.DailyLossUnknown })
  );
});

test("cancelling asks the broker and tells whoever shows the account, whatever it answered", async () => {
  const { desk, cancelOrder, onChange } = setup();

  await desk.cancel("B-7");

  expect(cancelOrder).toHaveBeenCalledExactlyOnceWith("B-7");
  expect(onChange).toHaveBeenCalledTimes(1);

  cancelOrder.mockRejectedValueOnce(new Error("already filled"));

  await expect(desk.cancel("B-7")).rejects.toThrow("already filled");
  expect(onChange).toHaveBeenCalledTimes(2);
});

test("a proposal keeps the session it went to and the price then, and holds only for that session", async () => {
  const { desk, placeOrder, clock } = setup(undefined, {
    lastPrice: async () => 975,
    priceLimits: async () => ({
      after: "2026-09-28",
      band: { low: 882, high: 1070 },
    }),
  });

  const { id, premise } = await proposeFromAgent(desk);

  expect(premise).toEqual({
    session: "2026-09-29",
    price: 975,
    band: { low: 882, high: 1070 },
  });

  // The next day's session, which the limits kept were not set for either.
  clock.now = Date.parse("2026-09-30T10:00:00+08:00");

  expect(await desk.confirm(id)).toMatchObject({
    status: ProposalStatus.Rejected,
    violations: [
      {
        code: RiskViolationCode.PremiseStale,
        proposedFor: "2026-09-29",
        session: "2026-09-30",
      },
    ],
  });
  expect(placeOrder).not.toHaveBeenCalled();
});

test("a proposal is refused once the price has moved past the most its premise allows, and sent within it", async () => {
  const price = { now: 975 };

  const { desk, placeOrder } = setup(undefined, {
    lastPrice: async () => price.now,
  });

  const moved = await proposeFromAgent(desk);
  const within = await proposeFromAgent(desk);

  price.now = 1010;

  expect(await desk.confirm(moved.id)).toMatchObject({
    status: ProposalStatus.Rejected,
    violations: [
      {
        code: RiskViolationCode.PriceMoved,
        proposedAt: 975,
        price: 1010,
        max: 0.03,
      },
    ],
  });

  price.now = 1000;

  expect(await desk.confirm(within.id)).toMatchObject({
    status: ProposalStatus.Submitted,
  });
  expect(placeOrder).toHaveBeenCalledOnce();
});

test("a price that cannot be read is not compared, and a proposal that kept no premise is refused", async () => {
  let price: number | null = 975;
  const store = memoryStore();

  const { desk } = setup(store, { lastPrice: async () => price });
  const { id } = await proposeFromAgent(desk);

  price = null;

  expect(await desk.confirm(id)).toMatchObject({
    status: ProposalStatus.Submitted,
  });

  const kept = await proposeFromAgent(desk);

  store.update({ ...kept, premise: null });

  expect(await desk.confirm(kept.id)).toMatchObject({
    status: ProposalStatus.Rejected,
    violations: [
      {
        code: RiskViolationCode.PremiseStale,
        proposedFor: null,
        session: "2026-09-29",
      },
    ],
  });
});

test("confirmations go one at a time, so a buy is checked against the loss a sale confirmed before it left", async () => {
  const { desk, account, getFills, placeOrder } = setup(undefined, {
    maxDailyLoss: () => ({ TWD: 50_000 }),
  });

  const fills: Fill[] = [];

  account.positions = [
    { instrument: order.instrument, quantity: 1000, avgPrice: 1100 },
  ];
  getFills.mockImplementation(async () => fills);
  placeOrder.mockImplementation(async (placed) => {
    if (placed.side === Side.Sell) {
      fills.push({
        orderId: "B-0",
        instrument: placed.instrument,
        side: Side.Sell,
        quantity: placed.quantity,
        price: 1000,
        filledAt: DURING_SESSION,
        realized: -100_000,
      });
    }

    return { orderId: `B-${fills.length}` };
  });

  const sale = await desk.propose({
    order: { ...order, side: Side.Sell },
    source: ProposalSource.User,
    rationale: "cut it",
  });

  const buy = await proposeFromAgent(desk);

  const [sold, bought] = await Promise.all([
    desk.confirm(sale.id),
    desk.confirm(buy.id),
  ]);

  expect(sold.status).toBe(ProposalStatus.Submitted);
  expect(bought).toMatchObject({
    status: ProposalStatus.Rejected,
    violations: [{ code: RiskViolationCode.DailyLossReached }],
  });
  expect(placeOrder).toHaveBeenCalledOnce();
});

test("a lock set while the checks wait on the quote still stops the order", async () => {
  let locked = false;
  let quote: (price: number) => void = noop;

  const { desk, placeOrder } = setup(undefined, {
    locked: () => locked,
    lastPrice: vi
      .fn<NonNullable<OrderDeskOptions["lastPrice"]>>()
      .mockResolvedValueOnce(975)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            quote = resolve;
          })
      ),
  });

  const { id } = await proposeFromAgent(desk);
  const confirming = desk.confirm(id);

  await vi.waitFor(() => expect(quote).not.toBe(noop));
  locked = true;
  quote(975);

  expect(await confirming).toMatchObject({
    status: ProposalStatus.Rejected,
    violations: [{ code: RiskViolationCode.OrdersLocked }],
  });
  expect(placeOrder).not.toHaveBeenCalled();
});

const covering = (overrides: Partial<Mandate> = {}): Mandate => ({
  broker: "fake",
  shadow: false,
  expiresAt: DURING_SESSION + 7 * DAY_MS,
  listings: [order.instrument],
  sides: [Side.Buy, Side.Sell],
  maxOrderValue: { TWD: 1_000_000 },
  maxDayValue: { TWD: 2_000_000 },
  maxDayOrders: 5,
  ...overrides,
});

test("an agent's proposal the mandate covers is sent without the user, and one it does not waits with why", async () => {
  let mandate = covering();
  const { desk, placeOrder } = setup(undefined, { mandate: () => mandate });

  expect(await proposeFromAgent(desk)).toMatchObject({
    status: ProposalStatus.Submitted,
    brokerOrderId: "B-1",
    mandate: { shadow: false, violations: [] },
  });
  expect(placeOrder).toHaveBeenCalledTimes(1);

  mandate = covering({ sides: [Side.Sell] });

  expect(await proposeFromAgent(desk)).toMatchObject({
    status: ProposalStatus.AwaitingConfirmation,
    mandate: { violations: [{ code: MandateViolationCode.Side }] },
  });
  expect(placeOrder).toHaveBeenCalledTimes(1);
});

test("in shadow the mandate only marks what it would send", async () => {
  const { desk, placeOrder } = setup(undefined, {
    mandate: () => covering({ shadow: true }),
  });

  expect(await proposeFromAgent(desk)).toMatchObject({
    status: ProposalStatus.AwaitingConfirmation,
    mandate: { shadow: true, violations: [] },
  });
  expect(placeOrder).not.toHaveBeenCalled();
});

test("the user's own proposal waits for them, and none the checks refused is put to the mandate", async () => {
  const { desk, placeOrder } = setup(undefined, { mandate: () => covering() });

  expect(
    await desk.propose({ order, source: ProposalSource.User, rationale: "" })
  ).toMatchObject({
    status: ProposalStatus.AwaitingConfirmation,
    mandate: null,
  });

  expect(
    await desk.propose({
      order: { ...order, quantity: 1500 },
      source: ProposalSource.Agent,
      rationale: "",
    })
  ).toMatchObject({ status: ProposalStatus.Rejected, mandate: null });
  expect(placeOrder).not.toHaveBeenCalled();
});

test("the mandate counts what it covered in the market day, shadow included", async () => {
  const { desk, clock } = setup(undefined, {
    mandate: () => covering({ shadow: true, maxDayOrders: 1 }),
  });

  await proposeFromAgent(desk);

  expect(await proposeFromAgent(desk)).toMatchObject({
    mandate: { violations: [{ code: MandateViolationCode.DayOrders, max: 1 }] },
  });

  clock.now = DURING_SESSION + DAY_MS;

  expect(await proposeFromAgent(desk)).toMatchObject({
    mandate: { violations: [] },
  });
});

test("an order sent under the mandate that went unanswered locks orders", async () => {
  const { desk, placeOrder, lockOrders } = setup(undefined, {
    mandate: () => covering(),
  });

  placeOrder.mockRejectedValueOnce(new Error("timeout"));

  expect(await proposeFromAgent(desk)).toMatchObject({
    status: ProposalStatus.Failed,
    failure: { code: SubmissionFailureCode.Unknown },
  });
  expect(lockOrders).toHaveBeenCalledTimes(1);

  // One the user confirmed is theirs to look into, and one the broker refused holds nothing.
  const { id } = await desk.propose({
    order,
    source: ProposalSource.User,
    rationale: "",
  });

  placeOrder.mockRejectedValueOnce(new Error("timeout"));
  await desk.confirm(id);
  placeOrder.mockRejectedValueOnce(new OrderRefusedError("no quota"));
  await proposeFromAgent(desk);

  expect(lockOrders).toHaveBeenCalledTimes(1);
});

test("a mandate revoked while its order waited for the one before leaves the order waiting for the user", async () => {
  let mandate: Mandate | null = covering();
  const { desk, placeOrder } = setup(undefined, { mandate: () => mandate });

  const { id } = await desk.propose({
    order,
    source: ProposalSource.User,
    rationale: "",
  });

  let answer: (placed: { orderId: string }) => void = noop;

  placeOrder.mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve;
    })
  );

  const first = desk.confirm(id);
  const covered = proposeFromAgent(desk);

  await vi.waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(1));
  mandate = null;
  answer({ orderId: "B-1" });
  await first;

  expect(await covered).toMatchObject({
    status: ProposalStatus.AwaitingConfirmation,
    mandate: null,
  });
  expect(placeOrder).toHaveBeenCalledTimes(1);
});
