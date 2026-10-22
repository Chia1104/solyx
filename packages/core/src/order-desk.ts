import { noop, omit, sumBy } from "es-toolkit";

import { errorMessage } from "@solyx/utils/error";

import { BrokerOrderStatus, OrderRefusedError, orderTag } from "./broker.ts";
import type {
  BrokerAdapter,
  BrokerMode,
  BrokerOrder,
  WatchedExitLeg,
} from "./broker.ts";
import type { Forecast } from "./forecast.ts";
import { mandateViolations } from "./mandate.ts";
import type { Mandate, MandateDay, MandateVerdict } from "./mandate.ts";
import {
  currencyOf,
  exchangeDate,
  exchangeMidnight,
  symbolKey,
} from "./market.ts";
import type { Currency, Market, SymbolRef } from "./market.ts";
import { OrderType, Side, exitLegs, realizedIn } from "./order.ts";
import type {
  AccountSnapshot,
  Exit,
  ExitRequest,
  Fill,
  OrderRequest,
} from "./order.ts";
import type { Report } from "./report.ts";
import {
  RiskViolationCode,
  checkExit,
  checkOrder,
  premiseViolations,
  sessionBand,
} from "./risk.ts";
import type {
  OrderPremise,
  PriceLimits,
  RiskLimits,
  RiskViolation,
} from "./risk.ts";
import { getSession, sessionDayAt, weekdays } from "./session.ts";
import type { TradingDays } from "./session.ts";

export const ProposalSource = {
  Agent: "agent",
  User: "user",
} as const;

export type ProposalSource =
  (typeof ProposalSource)[keyof typeof ProposalSource];

export const ProposalStatus = {
  AwaitingConfirmation: "awaiting-confirmation",
  /** The user confirmed it, and the desk checks it again before it reaches the broker. */
  Confirming: "confirming",
  /** It may have reached the broker. */
  Submitting: "submitting",
  Submitted: "submitted",
  Rejected: "rejected",
  Dismissed: "dismissed",
  Failed: "failed",
} as const;

export type ProposalStatus =
  (typeof ProposalStatus)[keyof typeof ProposalStatus];

export const SubmissionFailureCode = {
  /** The broker refused the order, so it holds nothing of it. */
  Refused: "refused",
  /** Placing the order failed without the broker saying it refused it, so it may hold the order. */
  Unknown: "unknown",
  /** The app exited before the broker answered, so it may hold the order. */
  Interrupted: "interrupted",
  /** Its session is over and the broker holds no order under its tag, so it never took it. */
  Absent: "absent",
} as const;

export type SubmissionFailure =
  | {
      code:
        | typeof SubmissionFailureCode.Refused
        | typeof SubmissionFailureCode.Unknown;
      message: string;
    }
  | {
      code:
        | typeof SubmissionFailureCode.Interrupted
        | typeof SubmissionFailureCode.Absent;
    };

/** What research held of a listing as a proposal for it was made, kept as it stood then. */
export interface ProposalBasis {
  /** The report in force; `null` while the listing had none. */
  report: Pick<Report, "revision" | "revisedAt" | "stance"> | null;
  /** The newest forecast made under that report; `null` while it had none. */
  forecast: Pick<Forecast, "id" | "createdAt" | "direction" | "horizon"> | null;
}

export interface TradeProposal {
  id: string;
  /** The id of the broker it was proposed to, the only one that may take it. */
  broker: string;
  order: OrderRequest;
  source: ProposalSource;
  /** Why this trade: the agent's argument or the user's note. Kept for the review log. */
  rationale: string;
  /** The research it was made under; `null` where the desk had none to read. */
  basis: ProposalBasis | null;
  /** What the market stood at as it was made; `null` where the desk kept none, which no confirmation accepts. */
  premise: OrderPremise | null;
  /**
   * What the user's mandate made of an agent's proposal that passed every check; `null` where
   * there was none to ask. One it covered outside shadow the desk sent itself.
   */
  mandate: MandateVerdict | null;
  createdAt: number;
  status: ProposalStatus;
  violations: RiskViolation[];
  brokerOrderId?: string;
  failure?: SubmissionFailure;
  /**
   * The exit whose sale `order` is, which the broker watches and sends itself rather than placing
   * the order as it is confirmed; missing for an order.
   */
  exit?: Exit;
  /** The broker's refs for the exit's legs once it watches them, in `exitLegs` order. */
  exitRefs?: string[];
  /** When the broker stopped watching the exit: once a leg sold, it expired or was taken off, or the user cancelled it. */
  exitEnded?: { at: number; cancelled: boolean };
}

/** Whether the broker watches the proposal's exit now. */
export function exitWatched(proposal: TradeProposal): boolean {
  return (
    proposal.exit !== undefined &&
    proposal.status === ProposalStatus.Submitted &&
    proposal.exitEnded === undefined
  );
}

/**
 * Where the desk keeps proposals across restarts. Synchronous so the desk can claim a
 * proposal before its first await, which is what stops a double click submitting twice.
 */
export interface ProposalStore {
  /** Oldest first. */
  list(): TradeProposal[];
  get(id: string): TradeProposal | undefined;
  add(proposal: TradeProposal): void;
  /** Replaces the stored proposal with the same id. */
  update(proposal: TradeProposal): void;
}

export interface OrderDeskOptions {
  /** The desk is its only holder, so nothing else can reach `placeOrder`. */
  broker: BrokerAdapter;
  store: ProposalStore;
  limits: RiskLimits;
  /**
   * The days a market trades, so an order on a holiday is checked against a closed session. It
   * must answer even while the exchange's days cannot be read.
   * @default every weekday trades
   */
  tradingDays?: (market: Market) => Promise<TradingDays>;
  /**
   * A listing's price limits as its exchange last set them, which a limit price is checked against
   * and a market order sized by. It must answer even while the exchange's lists cannot be read.
   * @default none are known: no limit price is checked against a band, and every market order is refused
   */
  priceLimits?: (symbol: SymbolRef) => Promise<PriceLimits | null>;
  /**
   * A listing's last price, which a proposal keeps as part of its premise and confirming it reads
   * again. It must answer even while quotes cannot be read, with `null`.
   * @default none is read, so only the session a proposal was made for is checked
   */
  lastPrice?: (symbol: SymbolRef) => Promise<number | null>;
  /**
   * Whether the user locked orders, read at every check, so a lock refuses proposals and stops
   * those waiting from being sent until it is lifted.
   * @default never locked
   */
  locked?: () => boolean;
  /**
   * The user's mandate, read at every agent proposal and again as one it covers is sent.
   * @default none, so every proposal waits for the user
   */
  mandate?: () => Mandate | null;
  /**
   * Locks orders as the user's lock does, which the desk asks for once an order it sent under the
   * mandate went unanswered, since whether the account holds it is not known.
   */
  lockOrders?: () => void;
  /**
   * The most the user lets the account's sales lose in a market's day, per currency, read at
   * every check: once the day's loss reaches it, buys in that currency are refused.
   * @default no limit
   */
  maxDailyLoss?: () => Partial<Record<Currency, number>>;
  /**
   * The store was put back from a backup. A proposal that waits in it may have been confirmed
   * since the backup was made, so the desk dismisses each as it opens.
   * @default false
   */
  restored?: boolean;
  /**
   * What research holds of a listing, which the desk keeps with each proposal for it, so neither
   * the agent nor the user picks what a proposal is reviewed against.
   * @default none is read, and proposals keep no basis
   */
  basis?: (symbol: SymbolRef) => ProposalBasis;
  /** Called after every change to a proposal or the account the desk hears of, so whoever shows them can refresh. */
  onChange?: () => void;
  now?: () => number;
  createId?: () => string;
}

/** The desk as an agent may use it: proposing and reading, never confirming, dismissing or cancelling. */
export type ProposingDesk = Pick<
  OrderDesk,
  "check" | "propose" | "list" | "account" | "fills" | "working" | "mode"
>;

/** The mandate covered it outside shadow, so the desk sends it without the user. */
function sentByMandate({ mandate }: TradeProposal): boolean {
  return mandate !== null && !mandate.shadow && mandate.violations.length === 0;
}

export const MandateSending = {
  /** The desk is checking it again before it sends it. */
  Checking: "checking",
  /** It reached the broker, or may have. */
  Sent: "sent",
  /** The checks before sending refused it or failed, so it waits for the user or was refused. */
  Stopped: "stopped",
} as const;

export type MandateSending =
  (typeof MandateSending)[keyof typeof MandateSending];

/** How far the desk got sending a proposal under the mandate; `null` where the mandate did not have it sent. */
export function mandateSending(proposal: TradeProposal): MandateSending | null {
  if (!sentByMandate(proposal)) return null;

  switch (proposal.status) {
    case ProposalStatus.Confirming:
      return MandateSending.Checking;
    case ProposalStatus.Submitting:
    case ProposalStatus.Submitted:
    case ProposalStatus.Failed:
      return MandateSending.Sent;
    default:
      return MandateSending.Stopped;
  }
}

// A broker's clock may run behind the app's, so a leg placed for a proposal may read as placed a little before it.
const PLACED_SKEW_MS = 60_000;

/** A failure that leaves whether the broker holds the order unknown, until the desk finds it. */
function mayBeHeld({ status, failure }: TradeProposal): boolean {
  return (
    status === ProposalStatus.Failed &&
    (failure?.code === SubmissionFailureCode.Unknown ||
      failure?.code === SubmissionFailureCode.Interrupted)
  );
}

/**
 * The only road from an idea to a real order: propose → risk check → human confirm → broker.
 * Agents get a `ProposingDesk`; `confirm` must stay behind a user action in the UI.
 */
export class OrderDesk {
  readonly #options: OrderDeskOptions;

  /** The confirmation under way, which the next one waits for. */
  #sending: Promise<unknown> = Promise.resolve();

  constructor(options: OrderDeskOptions) {
    this.#options = options;

    // Nobody shows proposals before the desk exists, so these changes are told to no one.
    for (const proposal of options.store.list()) {
      // The app exited mid-submission, so the broker may hold the order: fail it, never resubmit.
      if (proposal.status === ProposalStatus.Submitting) {
        options.store.update({
          ...proposal,
          status: ProposalStatus.Failed,
          failure: { code: SubmissionFailureCode.Interrupted },
        });

        // As for one unanswered: nothing more goes until the user has looked at the account.
        if (sentByMandate(proposal)) options.lockOrders?.();
      } else if (
        proposal.status === ProposalStatus.Confirming ||
        proposal.status === ProposalStatus.AwaitingConfirmation
      ) {
        // One that waited in a backup may have been confirmed since, and one proposed to another
        // broker was argued on that account, not this one.
        const stale = options.restored || proposal.broker !== options.broker.id;

        // The app exited while checking it again, before anything was sent, so it waits again.
        if (stale || proposal.status === ProposalStatus.Confirming) {
          options.store.update({
            ...proposal,
            status: stale
              ? ProposalStatus.Dismissed
              : ProposalStatus.AwaitingConfirmation,
          });
        }
      }
    }
  }

  list(): TradeProposal[] {
    return this.#options.store.list();
  }

  get mode(): BrokerMode {
    return this.#options.broker.mode;
  }

  /** The id of the broker and account it trades, which every proposal it makes keeps. */
  get brokerId(): string {
    return this.#options.broker.id;
  }

  account(): Promise<AccountSnapshot> {
    return this.#options.broker.getAccount();
  }

  /** The account's fills from `since`, UTC milliseconds, on, oldest first. */
  fills(since: number): Promise<Fill[]> {
    return this.#options.broker.getFills(since);
  }

  /** The account's orders placed from `since`, UTC milliseconds, on, oldest first. */
  orders(since: number): Promise<BrokerOrder[]> {
    return this.#options.broker.getOrders(since);
  }

  /**
   * Asks the broker to cancel the account's order `orderId`, whoever placed it; the account's
   * orders then tell what came of it. Only a user action reaches it.
   */
  async cancel(orderId: string): Promise<void> {
    try {
      await this.#options.broker.cancelOrder(orderId);
    } finally {
      // Whatever the broker answered, the account may have changed.
      this.#options.onChange?.();
    }
  }

  /**
   * The broker told of a change to the account's orders or fills, such as a fill: the host shows
   * the account anew, and the desk looks for the orders of proposals whose sending went unanswered.
   */
  async brokerChanged(): Promise<void> {
    this.#options.onChange?.();
    await this.reconcile();
  }

  /** The orders of the account's current market days that may still fill, oldest first. */
  async working(): Promise<BrokerOrder[]> {
    const { broker, now = Date.now } = this.#options;
    const at = new Date(now());

    const since = Math.min(
      ...broker.markets.map(
        (market) => exchangeMidnight(market, exchangeDate(market, at)) * 1000
      )
    );

    return (await broker.getOrders(since)).filter(
      ({ status }) =>
        status === BrokerOrderStatus.Pending ||
        status === BrokerOrderStatus.Working
    );
  }

  /**
   * Finds the orders of proposals whose sending failed without the broker refusing them, by the
   * tag each was placed with: one the broker holds is kept as submitted, and one it does not hold
   * once its session is over failed for good. Never sends anything.
   */
  async reconcile(): Promise<void> {
    const { broker, store, tradingDays, now = Date.now } = this.#options;

    await this.reconcileExits();

    const unsure = store
      .list()
      .filter(
        (proposal) =>
          proposal.broker === broker.id &&
          proposal.exit === undefined &&
          mayBeHeld(proposal)
      );

    if (unsure.length === 0) return;

    // Taken before the orders are read, so a session over by then is over in what they list.
    const at = new Date(now());

    const orders = await broker.getOrders(
      Math.min(...unsure.map(({ createdAt }) => createdAt))
    );

    for (const { id, order, premise } of unsure) {
      const tag = orderTag(id);
      const { instrument, side } = order;
      const trades = (await tradingDays?.(instrument.market)) ?? weekdays;

      const held = orders.find(
        (placed) =>
          placed.tag === tag &&
          symbolKey(placed.order.instrument) === symbolKey(instrument) &&
          placed.order.side === side
      );

      // Read again after the await: another reconcile may have settled it meanwhile.
      const proposal = store.get(id);

      if (!proposal || !mayBeHeld(proposal)) continue;

      if (held) {
        this.#save({
          ...omit(proposal, ["failure"]),
          status: ProposalStatus.Submitted,
          brokerOrderId: held.id,
        });
      } else if (
        premise &&
        sessionDayAt(instrument.market, at, trades) > premise.session
      ) {
        this.#save({
          ...proposal,
          failure: { code: SubmissionFailureCode.Absent },
        });
      }
    }
  }

  /**
   * The exits the broker watches, and those whose placing went unanswered, by the legs it watches
   * now: one whose placing went unanswered is kept as submitted once every leg is found, and once
   * one leg of an exit is no longer watched, since it sold, expired or was taken off, the others
   * are cancelled, so one sale ends the exit. Places nothing.
   */
  async reconcileExits(): Promise<void> {
    const { broker, store, now = Date.now } = this.#options;
    const { exits } = broker;

    if (!exits) return;

    const open = store
      .list()
      .filter(
        (proposal) =>
          proposal.broker === broker.id &&
          proposal.exit !== undefined &&
          (exitWatched(proposal) || mayBeHeld(proposal))
      );

    if (open.length === 0) return;

    const watched = await exits.watching();

    for (const { id } of open) {
      // Read again after each await: a cancel or another reconcile may have settled it meanwhile.
      const proposal = store.get(id);

      if (proposal && mayBeHeld(proposal)) {
        const refs = this.#placedLegs(proposal, watched);

        if (refs) {
          this.#save({
            ...omit(proposal, ["failure"]),
            status: ProposalStatus.Submitted,
            exitRefs: refs,
          });
        }
      } else if (proposal && exitWatched(proposal)) {
        const refs = proposal.exitRefs ?? [];

        const left = refs.filter((ref) =>
          watched.some((leg) => leg.ref === ref)
        );

        if (left.length === refs.length) continue;

        for (const ref of left) await exits.cancel(ref);

        const ended = store.get(id);

        if (ended && exitWatched(ended)) {
          this.#save({ ...ended, exitEnded: { at: now(), cancelled: false } });
        }
      }
    }
  }

  /** The refs of `proposal`'s exit legs among those `watched`, where the broker watches every one of them. */
  #placedLegs(
    { id, order, exit, createdAt }: TradeProposal,
    watched: WatchedExitLeg[]
  ): string[] | null {
    if (!exit) return null;

    // A leg another proposal already holds is not this one's.
    const held = new Set(
      this.#options.store
        .list()
        .flatMap((other) => (other.id === id ? [] : (other.exitRefs ?? [])))
    );

    const refs = exitLegs(exit).map(
      ({ leg, price }) =>
        watched.find(
          (placed) =>
            !held.has(placed.ref) &&
            placed.leg === leg &&
            placed.price === price &&
            placed.quantity === order.quantity &&
            symbolKey(placed.instrument) === symbolKey(order.instrument) &&
            placed.placedAt >= createdAt - PLACED_SKEW_MS
        )?.ref
    );

    return refs.every((ref) => ref !== undefined) ? refs : null;
  }

  /**
   * Asks the broker to stop watching exit `id`, a user's action alone; a leg that sold or ended
   * meanwhile is left as it is.
   */
  async cancelExit(id: string): Promise<TradeProposal> {
    const { broker, store, now = Date.now } = this.#options;
    const proposal = store.get(id);

    if (!proposal || !exitWatched(proposal) || !broker.exits) {
      throw new Error(`The broker watches no exit of proposal ${id}`);
    }

    try {
      const watched = await broker.exits.watching();

      for (const ref of proposal.exitRefs ?? []) {
        if (watched.some((leg) => leg.ref === ref)) {
          await broker.exits.cancel(ref);
        }
      }

      return this.#save({
        ...(store.get(id) ?? proposal),
        exitEnded: { at: now(), cancelled: true },
      });
    } finally {
      // Whatever the broker answered, what it watches may have changed.
      this.#options.onChange?.();
    }
  }

  /**
   * Proposes an order, or an exit whose sale the broker sends itself. A caller that may run again
   * after a crash passes the same `id` each time, and gets back the proposal already made under it
   * instead of a second one.
   */
  async propose({
    id,
    ...input
  }: {
    id?: string;
    source: ProposalSource;
    rationale: string;
  } & (
    | { order: OrderRequest }
    | { exit: ExitRequest }
  )): Promise<TradeProposal> {
    const {
      store,
      basis,
      now = Date.now,
      createId = () => crypto.randomUUID(),
    } = this.#options;

    const made = id === undefined ? undefined : store.get(id);

    if (made) return made;

    if ("exit" in input) {
      return this.#proposeExit(id ?? createId(), input);
    }

    const [{ violations, session, band }, price] = await Promise.all([
      this.#checked(input.order),
      this.#lastPrice(input.order.instrument),
    ]);

    const passed = violations.length === 0;
    const fromAgent = passed && input.source === ProposalSource.Agent;
    const proposalId = id ?? createId();

    // Nothing is awaited from here until the proposal is kept, so one made meanwhile counts in its day.
    const placed =
      fromAgent && this.#options.mandate?.()
        ? await this.#placedThatDay(input.order.instrument.market)
        : [];

    const createdAt = now();

    const proposal: TradeProposal = {
      id: proposalId,
      broker: this.#options.broker.id,
      ...input,
      basis: basis?.(input.order.instrument) ?? null,
      premise: { session, price, band },
      mandate: fromAgent
        ? this.#verdict(proposalId, input.order, createdAt, placed)
        : null,
      createdAt,
      status: passed
        ? ProposalStatus.AwaitingConfirmation
        : ProposalStatus.Rejected,
      violations,
    };

    store.add(proposal);
    this.#options.onChange?.();

    if (!sentByMandate(proposal)) return proposal;

    // A check that fails sends nothing and leaves the proposal waiting for the user.
    return this.#dispatch(proposal, true).catch(
      () => store.get(proposal.id) ?? proposal
    );
  }

  /** The exit as an order to sell its shares, which the broker sends at its prices. */
  async #proposeExit(
    id: string,
    {
      exit: request,
      ...input
    }: { exit: ExitRequest; source: ProposalSource; rationale: string }
  ): Promise<TradeProposal> {
    const { store, basis, now = Date.now } = this.#options;
    const { instrument, quantity, stop, target, until } = request;
    const { violations, session, price } = await this.#checkedExit(id, request);

    const proposal: TradeProposal = {
      id,
      broker: this.#options.broker.id,
      order: { instrument, side: Side.Sell, quantity, type: OrderType.Market },
      exit: { stop, target, until },
      ...input,
      basis: basis?.(instrument) ?? null,
      premise: { session, price, band: null },
      // The mandate sends no exit: each waits for the user.
      mandate: null,
      createdAt: now(),
      status:
        violations.length === 0
          ? ProposalStatus.AwaitingConfirmation
          : ProposalStatus.Rejected,
      violations,
    };

    store.add(proposal);
    this.#options.onChange?.();

    return proposal;
  }

  /** The orders the broker lists from the start of `market`'s day on; `null` where they could not be read. */
  async #placedThatDay(market: Market): Promise<BrokerOrder[] | null> {
    const { broker, now = Date.now } = this.#options;
    const day = exchangeDate(market, new Date(now()));

    return broker
      .getOrders(exchangeMidnight(market, day) * 1000)
      .catch(() => null);
  }

  /**
   * What the mandate makes of an agent's order now, given the orders the broker lists for its day,
   * or `null` while the user has none. Where those could not be read, it covers nothing.
   */
  #verdict(
    id: string,
    order: OrderRequest,
    at: number,
    placed: BrokerOrder[] | null
  ): MandateVerdict | null {
    const mandate = this.#options.mandate?.();

    if (!mandate) return null;

    return {
      shadow: mandate.shadow,
      violations: mandateViolations(mandate, {
        order,
        fromAgent: true,
        broker: this.#options.broker.id,
        currency: currencyOf(order.instrument.market),
        now: at,
        day: placed && this.#mandateDay(id, order, at, placed),
      }),
    };
  }

  /**
   * What the mandate covered in the market day of an order made at `at`, besides proposal `id`,
   * with every order of that day `placed` under a tag no kept proposal carries: a restored backup
   * or an edited store loses proposals but not the broker's orders, so those count as the
   * mandate's rather than let it send a day's worth again.
   */
  #mandateDay(
    id: string,
    order: OrderRequest,
    at: number,
    placed: BrokerOrder[]
  ): MandateDay {
    const { market } = order.instrument;
    const day = exchangeDate(market, new Date(at));
    const currency = currencyOf(market);
    const proposals = this.#options.store.list();

    const kept = new Set(
      [id, ...proposals.map((proposal) => proposal.id)].map(orderTag)
    );

    const inDay = ({ instrument }: OrderRequest, time: number) =>
      currencyOf(instrument.market) === currency &&
      exchangeDate(market, new Date(time)) === day;

    const covered = [
      ...proposals
        .filter(
          (proposal) =>
            proposal.id !== id &&
            proposal.mandate?.violations.length === 0 &&
            inDay(proposal.order, proposal.createdAt)
        )
        .map((proposal) => proposal.order),
      ...placed
        .filter(
          ({ tag, order: made, placedAt }) =>
            tag !== null && !kept.has(tag) && inDay(made, placedAt)
        )
        .map((lost) => lost.order),
    ];

    return {
      orders: covered.length,
      value: sumBy(covered, (covering) =>
        covering.type === OrderType.Limit
          ? covering.limitPrice * covering.quantity
          : 0
      ),
    };
  }

  /**
   * Checks the proposal again and sends it. Confirmations go one at a time, each checked once the
   * one before it has had the broker's answer, so a check reads the cash, shares and fills that
   * order left. A check that fails sends nothing, so the proposal waits for the user again and the
   * failure is thrown; once the order may have reached the broker, every outcome is kept on the
   * proposal.
   */
  async confirm(id: string): Promise<TradeProposal> {
    return this.#dispatch(this.#pending(id), false);
  }

  /** Sends `pending` once the confirmation before it has had the broker's answer. */
  #dispatch(
    pending: TradeProposal,
    byMandate: boolean
  ): Promise<TradeProposal> {
    // Claim it before any await so a double click cannot submit twice.
    this.#save({ ...pending, status: ProposalStatus.Confirming });

    const confirmed = this.#sending.then(() => this.#send(pending, byMandate));

    // One that fails leaves the next to go on.
    this.#sending = confirmed.catch(noop);

    return confirmed;
  }

  async #send(
    pending: TradeProposal,
    byMandate: boolean
  ): Promise<TradeProposal> {
    if (pending.exit) return this.#sendExit(pending, pending.exit);

    const { broker, now = Date.now } = this.#options;

    if (byMandate) {
      const placed = await this.#placedThatDay(pending.order.instrument.market);

      // The user may have changed or revoked the mandate while the orders before it went.
      const mandate = this.#verdict(pending.id, pending.order, now(), placed);

      if (!mandate || mandate.shadow || mandate.violations.length > 0) {
        return this.#save({
          ...pending,
          status: ProposalStatus.AwaitingConfirmation,
          mandate,
        });
      }
    }

    let violations: RiskViolation[];

    try {
      // Prices and sessions move between propose and confirm; check again.
      const [checked, price] = await Promise.all([
        this.#checked(pending.order),
        this.#lastPrice(pending.order.instrument),
      ]);

      violations = [
        ...premiseViolations(pending.premise, {
          session: checked.session,
          price,
        }),
        ...checked.violations,
      ];
    } catch (error) {
      this.#save(pending);

      throw error;
    }

    // The user may have locked orders while the checks waited on the broker and the quote.
    if (
      this.#options.locked?.() &&
      !violations.some(({ code }) => code === RiskViolationCode.OrdersLocked)
    ) {
      violations = [{ code: RiskViolationCode.OrdersLocked }, ...violations];
    }

    if (violations.length > 0) {
      return this.#save({
        ...pending,
        status: ProposalStatus.Rejected,
        violations,
      });
    }

    const sending: TradeProposal = {
      ...pending,
      status: ProposalStatus.Submitting,
      violations,
    };

    this.#save(sending);

    try {
      const { orderId } = await broker.placeOrder(
        sending.order,
        orderTag(sending.id)
      );

      return this.#save({
        ...sending,
        status: ProposalStatus.Submitted,
        brokerOrderId: orderId,
      });
    } catch (error) {
      // Terminal on purpose: unless the broker refused it, it may hold the order, so never auto-retry.
      const failed = this.#save({
        ...sending,
        status: ProposalStatus.Failed,
        failure: {
          code:
            error instanceof OrderRefusedError
              ? SubmissionFailureCode.Refused
              : SubmissionFailureCode.Unknown,
          message: errorMessage(error),
        },
      });

      if (mayBeHeld(failed)) {
        // Nothing more goes until the user has looked at what the account holds.
        if (byMandate) this.#options.lockOrders?.();

        // The broker may list the order already; where it cannot be read, the failure stands.
        void this.reconcile().catch(noop);
      }

      return failed;
    }
  }

  /**
   * Checks the exit again against the session and price now, refusing it as an order is refused
   * once either has moved past its premise, and has the broker watch it.
   */
  async #sendExit(pending: TradeProposal, exit: Exit): Promise<TradeProposal> {
    const { broker } = this.#options;
    const { instrument, quantity } = pending.order;
    let violations: RiskViolation[];

    try {
      const checked = await this.#checkedExit(pending.id, {
        ...exit,
        instrument,
        quantity,
      });

      violations = [
        ...premiseViolations(pending.premise, checked),
        ...checked.violations,
      ];
    } catch (error) {
      this.#save(pending);

      throw error;
    }

    // The user may have locked orders while the checks waited on the broker and the quote.
    if (
      this.#options.locked?.() &&
      !violations.some(({ code }) => code === RiskViolationCode.OrdersLocked)
    ) {
      violations = [{ code: RiskViolationCode.OrdersLocked }, ...violations];
    }

    if (violations.length > 0 || !broker.exits) {
      return this.#save({
        ...pending,
        status: ProposalStatus.Rejected,
        violations,
      });
    }

    const sending: TradeProposal = {
      ...pending,
      status: ProposalStatus.Submitting,
      violations,
    };

    this.#save(sending);

    try {
      const refs = await broker.exits.place(
        instrument,
        quantity,
        exit,
        orderTag(sending.id)
      );

      return this.#save({
        ...sending,
        status: ProposalStatus.Submitted,
        exitRefs: refs,
      });
    } catch (error) {
      // As for an order: unless the broker refused it, it may watch the exit, so never place it again.
      const failed = this.#save({
        ...sending,
        status: ProposalStatus.Failed,
        failure: {
          code:
            error instanceof OrderRefusedError
              ? SubmissionFailureCode.Refused
              : SubmissionFailureCode.Unknown,
          message: errorMessage(error),
        },
      });

      if (mayBeHeld(failed)) void this.reconcile().catch(noop);

      return failed;
    }
  }

  /** The exit's checks, with the session it was made in and the price it was checked against. */
  async #checkedExit(id: string, request: ExitRequest) {
    const {
      broker,
      store,
      tradingDays,
      locked,
      now = Date.now,
    } = this.#options;

    const { instrument } = request;
    const at = new Date(now());
    const trades = (await tradingDays?.(instrument.market)) ?? weekdays;

    const [account, price] = await Promise.all([
      broker.getAccount(),
      this.#lastPrice(instrument),
    ]);

    // Shares the broker may already sell for the listing's other exits.
    const covered = sumBy(
      store
        .list()
        .filter(
          (other) =>
            other.id !== id &&
            other.broker === broker.id &&
            other.exit !== undefined &&
            symbolKey(other.order.instrument) === symbolKey(instrument) &&
            (exitWatched(other) ||
              mayBeHeld(other) ||
              other.status === ProposalStatus.Submitting)
        ),
      ({ order }) => order.quantity
    );

    return {
      violations: checkExit(request, {
        markets: broker.markets,
        account,
        locked: locked?.() ?? false,
        watches: broker.exits !== undefined,
        price,
        today: exchangeDate(instrument.market, at),
        covered,
      }),
      session: sessionDayAt(instrument.market, at, trades),
      price,
    };
  }

  dismiss(id: string): TradeProposal {
    const proposal: TradeProposal = {
      ...this.#pending(id),
      status: ProposalStatus.Dismissed,
    };

    this.#save(proposal);

    return proposal;
  }

  /** The risk checks alone, so an order can be tried before it is proposed. */
  async check(order: OrderRequest): Promise<RiskViolation[]> {
    return (await this.#checked(order)).violations;
  }

  /** The checks, with the session the order goes to and its band, which a proposal keeps. */
  async #checked(order: OrderRequest) {
    const {
      broker,
      limits,
      tradingDays,
      priceLimits,
      locked,
      now = Date.now,
    } = this.#options;

    const { instrument } = order;
    const at = new Date(now());
    const trades = (await tradingDays?.(instrument.market)) ?? weekdays;

    const [account, listed, dailyLoss] = await Promise.all([
      broker.getAccount(),
      priceLimits?.(instrument) ?? null,
      this.#dailyLoss(order, at),
    ]);

    const priceBand = sessionBand(listed, instrument.market, at, trades);

    return {
      violations: checkOrder(order, limits, {
        session: getSession(instrument.market, at, trades),
        markets: broker.markets,
        account,
        locked: locked?.() ?? false,
        dailyLoss,
        priceBand,
      }),
      session: sessionDayAt(instrument.market, at, trades),
      band: priceBand ?? null,
    };
  }

  async #lastPrice(symbol: SymbolRef): Promise<number | null> {
    return (await this.#options.lastPrice?.(symbol)) ?? null;
  }

  /** The day's loss against its limit, read from the broker only for a buy that has one. */
  async #dailyLoss({ instrument, side }: OrderRequest, at: Date) {
    const currency = currencyOf(instrument.market);
    const max = this.#options.maxDailyLoss?.()[currency];

    if (side !== Side.Buy || max === undefined) return undefined;

    const dayStart = exchangeMidnight(
      instrument.market,
      exchangeDate(instrument.market, at)
    );

    const fills = await this.#options.broker.getFills(dayStart * 1000);

    return { realized: realizedIn(fills, currency), max };
  }

  #save(proposal: TradeProposal): TradeProposal {
    this.#options.store.update(proposal);
    this.#options.onChange?.();

    return proposal;
  }

  #pending(id: string): TradeProposal {
    const proposal = this.#options.store.get(id);

    if (!proposal) throw new Error(`Proposal ${id} not found`);

    if (proposal.status !== ProposalStatus.AwaitingConfirmation) {
      throw new Error(
        `Proposal ${id} is ${proposal.status} and can no longer change`
      );
    }

    return proposal;
  }
}
