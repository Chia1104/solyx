import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageChannel } from "node:worker_threads";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import { oc } from "@orpc/contract";
import type { RouterContractClient } from "@orpc/contract";
import type { PublisherSubscribeListenerOptions } from "@orpc/publisher";
import { MemoryPublisher } from "@orpc/publisher/memory";
import { noop } from "es-toolkit";
import { expect, test } from "vite-plus/test";
import * as z from "zod";

import { ApprovalMode } from "@solyx/agent/wire";
import { SignedActionKind } from "@solyx/api/devices";
import type { routerContract } from "@solyx/api/rpc/router.contract";
import { BrokerMode } from "@solyx/core/broker";
import { Market } from "@solyx/core/market";
import { OrderType, Side } from "@solyx/core/order";
import type { OrderRequest } from "@solyx/core/order";
import { OrderDesk, ProposalSource } from "@solyx/core/order-desk";
import type { TradeProposal } from "@solyx/core/order-desk";
import { Session, weekdays } from "@solyx/core/session";

import type { AgentService } from "../src/modules/agent/agent-service.ts";
import { createDeviceRegistry } from "../src/modules/devices/device-registry.ts";
import type { Devices } from "../src/modules/devices/devices.ts";
import { createPasskeys } from "../src/modules/devices/passkeys.ts";
import { createSecretStore } from "../src/modules/settings/secret-store.ts";
import { ClientKind } from "../src/rpc/context.ts";
import type {
  DeviceClient,
  RpcClient,
  RpcContext,
} from "../src/rpc/context.ts";
import { rpcHandler } from "../src/rpc/serve.ts";
import type { WindowEvents } from "../src/rpc/window-events.ts";

import { fakeCipher } from "./fake-cipher.ts";
import { softwarePasskey } from "./software-passkey.ts";

const PHONE: DeviceClient = {
  kind: ClientKind.Device,
  device: "d1",
  origin: "http://localhost:18321",
};

const ORDER: OrderRequest = {
  instrument: { market: Market.TW, symbol: "2330" },
  side: Side.Buy,
  type: OrderType.Limit,
  limitPrice: 1_000,
  quantity: 1_000,
};

function paperDesk() {
  const proposals = new Map<string, TradeProposal>();

  return new OrderDesk({
    broker: {
      id: "fake",
      mode: BrokerMode.Paper,
      markets: [Market.TW],
      getAccount: async () => ({ cash: { TWD: 5_000_000 }, positions: [] }),
      getFills: async () => [],
      getOrders: async () => [],
      cancelOrder: async () => undefined,
      placeOrder: async () => ({ orderId: "B-1" }),
    },
    store: {
      list: () => [...proposals.values()],
      get: (id) => proposals.get(id),
      add: (proposal) => proposals.set(proposal.id, proposal),
      update: (proposal) => proposals.set(proposal.id, proposal),
    },
    limits: {
      maxOrderNotional: { TWD: 5_000_000, USD: 10_000 },
      allowedSessions: Object.values(Session),
    },
    tradingDays: async () => weekdays,
    restored: false,
    onChange: noop,
  });
}

/** A publisher that counts its listeners, to tell when a window's stream has let go. */
class CountedPublisher extends MemoryPublisher<WindowEvents> {
  listeners = 0;

  #onLeave: () => void = noop;

  /** Resolves once the publisher has no listener left. */
  untilAlone(): Promise<void> {
    return new Promise((resolve) => {
      this.#onLeave = () => {
        if (this.listeners === 0) resolve();
      };
    });
  }

  protected override async subscribeListener<
    K extends keyof WindowEvents & string,
  >(
    event: K,
    listener: (payload: WindowEvents[K]) => void,
    options?: PublisherSubscribeListenerOptions
  ) {
    const unsubscribe = await super.subscribeListener(event, listener, options);

    this.listeners += 1;

    return async () => {
      await unsubscribe();
      this.listeners -= 1;
      this.#onLeave();
    };
  }
}

/**
 * Serves the router on one end of a channel as the main process serves a window's, and returns a
 * window's link on the other end, its client and what closes it.
 */
function connect(
  services: Partial<RpcContext>,
  asking: RpcClient = { kind: ClientKind.Window, window: 1 }
) {
  const { port1: serverPort, port2: clientPort } = new MessageChannel();

  // SAFETY: each test calls only the procedures that read what it hands over.
  rpcHandler.upgrade(serverPort, {
    context: { ...services, client: asking } as RpcContext,
  });
  serverPort.start();
  clientPort.start();

  const link = new RPCLink({ port: clientPort });

  const client: RouterContractClient<typeof routerContract> =
    createORPCClient(link);

  return { link, client, close: () => clientPort.close() };
}

test("a window's proposal reaches the desk as the user's", async () => {
  const desk = paperDesk();
  const { client, close } = connect({ desk });

  const made = await client.proposals.propose({
    order: ORDER,
    rationale: "Earnings beat",
  });

  expect(made).toMatchObject({
    order: ORDER,
    rationale: "Earnings beat",
    source: ProposalSource.User,
  });
  expect(desk.list()).toEqual([made]);

  close();
});

test("a window is told the main process's own message for a failure", async () => {
  const { client, close } = connect({ desk: paperDesk() });

  await expect(client.proposals.confirm("p1")).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
    message: "Proposal p1 not found",
  });

  close();
});

test("input that does not parse is refused in words before the desk is reached", async () => {
  const { link, close } = connect({});

  // What a window that sends a number for the id is typed against.
  const misbehaving = {
    proposals: { confirm: oc.input(z.number()) },
  };

  const client: RouterContractClient<typeof misbehaving> =
    createORPCClient(link);

  await expect(client.proposals.confirm(7)).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: expect.stringMatching(/^Invalid input for proposals\.confirm: /),
  });

  close();
});

test("a window hears each change it follows", async () => {
  const windowEvents = new MemoryPublisher<WindowEvents>();
  const { client, close } = connect({ windowEvents });

  const changes = await client.proposals.changes();

  void windowEvents.publish("proposals:changed", {});

  await expect(changes.next()).resolves.toEqual({ done: false, value: {} });

  await changes.return();
  close();
});

test("a window's port closing lets go of what it followed", async () => {
  const windowEvents = new CountedPublisher();
  const { client, close } = connect({ windowEvents });

  const changes = await client.inbox.changes();

  expect(windowEvents.listeners).toBe(1);

  const alone = windowEvents.untilAlone();

  close();
  await alone;

  expect(windowEvents.listeners).toBe(0);

  await changes.return();
});

test("a paired device is refused what its contract keeps for windows, before the desk is reached", async () => {
  const desk = paperDesk();

  const made = await desk.propose({
    order: ORDER,
    rationale: "Earnings beat",
    source: ProposalSource.User,
  });

  const { client, close } = connect({ desk }, PHONE);

  await expect(client.proposals.confirm(made.id)).rejects.toMatchObject({
    code: "FORBIDDEN",
    message: "proposals.confirm is for this computer's own windows",
  });
  expect(desk.list()[0]?.status).toBe(made.status);
  // What its contract opens to devices it may call.
  expect(await client.proposals.list()).toEqual(desk.list());

  close();
});

test("a paired device starts only conversations that ask, and its messages' runs ask every call", async () => {
  const sent: { id: string; asksEveryCall: boolean }[] = [];

  const agent: Partial<AgentService> = {
    createSession: async (setup) => ({
      id: "s1",
      title: "",
      createdAt: 0,
      updatedAt: 0,
      ...setup,
      schedule: null,
    }),
    send: async (id, _text, _screen, _locale, _timeZone, asksEveryCall) => {
      sent.push({ id, asksEveryCall });
    },
  };

  // SAFETY: the clients call only the procedures that read these two.
  const device = connect({ agent: agent as AgentService }, PHONE);

  const setup = { model: null, thinking: null };

  await expect(
    device.client.agent.createSession({
      ...setup,
      approvalMode: ApprovalMode.Bypass,
    })
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    device.client.agent.createSession({
      ...setup,
      approvalMode: ApprovalMode.Auto,
    })
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    device.client.agent.createSession({
      ...setup,
      approvalMode: ApprovalMode.Ask,
    })
  ).resolves.toMatchObject({ approvalMode: ApprovalMode.Ask });

  const message = {
    id: "s1",
    text: "How did 2330 close?",
    screen: null,
    locale: "en-US",
    timeZone: "Asia/Taipei",
  } as const;

  await device.client.agent.send(message);
  device.close();

  // SAFETY: as above.
  const window = connect({ agent: agent as AgentService });

  await window.client.agent.send(message);
  window.close();

  expect(sent).toEqual([
    { id: "s1", asksEveryCall: true },
    { id: "s1", asksEveryCall: false },
  ]);
});

test("a paired browser submits only what its passkey signed, and a window never takes the signed road", async () => {
  const desk = paperDesk();

  const made = await desk.propose({
    order: ORDER,
    rationale: "Earnings beat",
    source: ProposalSource.User,
  });

  const dir = await mkdtemp(join(tmpdir(), "solyx-rpc-"));

  const registry = createDeviceRegistry(
    createSecretStore(join(dir, "secrets.json"), fakeCipher().cipher)
  );

  const passkeys = createPasskeys(registry, noop);
  const { device } = await registry.pair("Phone");
  const key = softwarePasskey(PHONE.origin);

  passkeys.paired(device.id);

  const devices: Partial<Devices> = { passkeys };

  // SAFETY: the clients call only the procedures that read the desk and the passkeys.
  const browser = connect(
    { desk, devices: devices as Devices },
    { ...PHONE, device: device.id }
  );

  await browser.client.devices.addPasskey(
    key.register(await browser.client.devices.passkeyOptions())
  );

  const elsewhere = key.sign(
    await browser.client.devices.actionOptions({
      kind: SignedActionKind.Confirm,
      id: "another",
    })
  );

  await expect(
    browser.client.proposals.confirmSigned({
      id: made.id,
      assertion: elsewhere,
    })
  ).rejects.toMatchObject({
    message: "Sign this with the browser's passkey first",
  });
  expect(desk.list()[0]?.status).toBe(made.status);

  const signed = key.sign(
    await browser.client.devices.actionOptions({
      kind: SignedActionKind.Confirm,
      id: made.id,
    })
  );

  const confirmed = await browser.client.proposals.confirmSigned({
    id: made.id,
    assertion: signed,
  });

  expect(confirmed.status).not.toBe(made.status);
  browser.close();

  // SAFETY: as above.
  const window = connect({ desk, devices: devices as Devices });

  await expect(
    window.client.proposals.confirmSigned({ id: made.id, assertion: signed })
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  window.close();
});
