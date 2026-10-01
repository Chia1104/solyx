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
import type { OrderRequest } from "../src/order.ts";
import type { RiskContext } from "../src/risk.ts";
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

function setup(
  context: RiskContext = { session: Session.Regular },
  store = memoryStore()
) {
  const placeOrder = vi
    .fn<BrokerAdapter["placeOrder"]>()
    .mockResolvedValue({ orderId: "B-1" });

  const broker: BrokerAdapter = {
    id: "fake",
    mode: BrokerMode.Paper,
    markets: [Market.TW],
    getAccount: async () => ({ cash: {}, positions: [] }),
    placeOrder,
    cancelOrder: vi.fn<BrokerAdapter["cancelOrder"]>().mockResolvedValue(),
  };

  const riskContext = vi.fn(async () => context);

  const desk = new OrderDesk({
    broker,
    store,
    limits: {
      maxOrderNotional: { TWD: 5_000_000, USD: 10_000 },
      allowedSessions: [Session.Regular],
    },
    riskContext,
  });

  return { desk, placeOrder, riskContext, store };
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
  const { desk, riskContext, store } = setup();

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
  expect(riskContext).toHaveBeenCalledTimes(1);
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
  const { desk, placeOrder, riskContext } = setup();
  const { id } = await proposeFromAgent(desk);
  riskContext.mockResolvedValueOnce({ session: Session.Closed });
  const confirmed = await desk.confirm(id);

  expect(confirmed.status).toBe(ProposalStatus.Rejected);
  expect(placeOrder).not.toHaveBeenCalled();
});

test("rejected proposals cannot be confirmed", async () => {
  const { desk, placeOrder } = setup({ session: Session.Closed });
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

  const reopened = setup(undefined, store);

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

  const reopened = setup(undefined, store);

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
