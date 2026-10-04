import { noop } from "es-toolkit";
import { expect, test, vi } from "vite-plus/test";

import { BrokerMode } from "../src/broker.ts";
import type { BrokerAdapter } from "../src/broker.ts";
import { InstrumentKind, Market } from "../src/market.ts";
import {
  OrderDesk,
  ProposalSource,
  ProposalStatus,
  SubmissionFailureCode,
} from "../src/order-desk.ts";
import type { ProposalStore, TradeProposal } from "../src/order-desk.ts";
import { OrderType, Side } from "../src/order.ts";
import type { AccountSnapshot, OrderRequest } from "../src/order.ts";
import { RiskViolationCode } from "../src/risk.ts";
import { Session } from "../src/session.ts";

const order: OrderRequest = {
  instrument: { market: Market.TW, symbol: "2330", kind: InstrumentKind.Stock },
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

function setup(store = memoryStore()) {
  const clock = { now: DURING_SESSION };
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
    onChange,
    now: () => clock.now,
  });

  return { desk, placeOrder, getAccount, account, clock, store, onChange };
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
        kind: InstrumentKind.Stock,
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
