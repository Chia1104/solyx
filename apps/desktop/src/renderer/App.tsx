import { useCallback, useEffect, useState } from "react";

import { BrokerMode } from "@solyx/core/broker";
import { InstrumentKind, Market } from "@solyx/core/market";
import { OrderType, Side } from "@solyx/core/order";
import type { OrderRequest } from "@solyx/core/order";
import { ProposalSource, ProposalStatus } from "@solyx/core/order-desk";
import type { TradeProposal } from "@solyx/core/order-desk";
import { Session } from "@solyx/core/session";
import { isEnumValue } from "@solyx/utils/is";

import type { Overview } from "../shared/ipc.ts";

const MARKET_LABEL: Record<Market, string> = {
  [Market.TW]: "Taiwan",
  [Market.US]: "US",
};

const SESSION_LABEL: Record<Session, string> = {
  [Session.Pre]: "Pre-market",
  [Session.Regular]: "Regular",
  [Session.Post]: "After-hours",
  [Session.Closed]: "Closed",
};

const STATUS_LABEL: Record<ProposalStatus, string> = {
  [ProposalStatus.AwaitingConfirmation]: "Awaiting confirmation",
  [ProposalStatus.Submitting]: "Submitting",
  [ProposalStatus.Submitted]: "Submitted",
  [ProposalStatus.Rejected]: "Rejected by risk checks",
  [ProposalStatus.Dismissed]: "Dismissed",
  [ProposalStatus.Failed]: "Failed",
};

function formText(data: FormData, name: string): string {
  const value = data.get(name);

  return value === null || value instanceof File ? "" : value;
}

/** The form is the renderer's input boundary; select values are narrowed here, not asserted. */
function parseOrderForm(data: FormData): OrderRequest {
  const market = formText(data, "market");
  const kind = formText(data, "kind");
  const side = formText(data, "side");

  if (
    !isEnumValue(Market, market) ||
    !isEnumValue(InstrumentKind, kind) ||
    !isEnumValue(Side, side)
  ) {
    throw new Error("The order form has invalid fields");
  }

  return {
    instrument: {
      market,
      symbol: formText(data, "symbol").trim().toUpperCase(),
      kind,
    },
    side,
    quantity: Number(formText(data, "quantity")),
    type: OrderType.Limit,
    limitPrice: Number(formText(data, "limitPrice")),
  };
}

export function App() {
  const [overview, setOverview] = useState<Overview>();
  const [error, setError] = useState<string>();

  const attempt = useCallback(async (task: () => Promise<void>) => {
    try {
      await task();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, []);

  const refresh = useCallback(async () => {
    setOverview(await window.solyx.getOverview());
  }, []);

  useEffect(() => {
    void attempt(refresh);
    const timer = setInterval(() => void attempt(refresh), 5000);

    return () => clearInterval(timer);
  }, [attempt, refresh]);

  async function act(action: () => Promise<TradeProposal>) {
    setError(undefined);
    await attempt(async () => {
      await action();
    });
    await attempt(refresh);
  }

  if (!overview) return <main>{error ?? "Loading…"}</main>;

  const { account, proposals } = overview;

  return (
    <main>
      <header>
        <h1>Solyx</h1>
        <span className={`mode mode-${overview.brokerMode}`}>
          {overview.brokerMode === BrokerMode.Paper
            ? "Paper trading"
            : "Live trading"}
        </span>
      </header>

      {error && <p className="error">{error}</p>}

      <section>
        <h2>Market sessions</h2>
        <ul className="sessions">
          {Object.values(Market).map((market) => (
            <li key={market}>
              {MARKET_LABEL[market]}: {SESSION_LABEL[overview.sessions[market]]}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Account</h2>
        <p>
          {Object.entries(account.cash)
            .map(
              ([currency, amount]) => `${currency} ${amount?.toLocaleString()}`
            )
            .join(" · ")}
        </p>
        {account.positions.length === 0 ? (
          <p className="muted">No positions</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Shares</th>
                <th>Avg. price</th>
              </tr>
            </thead>
            <tbody>
              {account.positions.map((p) => (
                <tr key={`${p.instrument.market}:${p.instrument.symbol}`}>
                  <td>
                    {MARKET_LABEL[p.instrument.market]} {p.instrument.symbol}
                  </td>
                  <td>{p.quantity.toLocaleString()}</td>
                  <td>{p.avgPrice.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>New order proposal</h2>
        <ProposalForm
          onSubmit={(data) =>
            act(() =>
              window.solyx.proposeOrder(
                parseOrderForm(data),
                formText(data, "rationale")
              )
            )
          }
        />
      </section>

      <section>
        <h2>Proposals</h2>
        {proposals.length === 0 ? (
          <p className="muted">No proposals yet</p>
        ) : (
          <ul className="proposals">
            {proposals.toReversed().map((proposal) => (
              <ProposalItem
                key={proposal.id}
                proposal={proposal}
                onConfirm={() =>
                  void act(() => window.solyx.confirmProposal(proposal.id))
                }
                onDismiss={() =>
                  void act(() => window.solyx.dismissProposal(proposal.id))
                }
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function ProposalForm({
  onSubmit,
}: {
  onSubmit: (data: FormData) => Promise<void>;
}) {
  return (
    <form action={onSubmit} className="proposal-form">
      <select name="market">
        <option value={Market.TW}>Taiwan</option>
        <option value={Market.US}>US</option>
      </select>
      <select name="kind">
        <option value={InstrumentKind.Stock}>Stock</option>
        <option value={InstrumentKind.ETF}>ETF</option>
      </select>
      <input name="symbol" placeholder="Symbol, e.g. 2330" required />
      <select name="side">
        <option value={Side.Buy}>Buy</option>
        <option value={Side.Sell}>Sell</option>
      </select>
      <input
        name="quantity"
        type="number"
        min="1"
        step="1"
        placeholder="Shares"
        required
      />
      <input
        name="limitPrice"
        type="number"
        min="0"
        step="any"
        placeholder="Limit price"
        required
      />
      <input name="rationale" placeholder="Rationale (kept in the log)" />
      <button type="submit">Create proposal</button>
    </form>
  );
}

function ProposalItem({
  proposal,
  onConfirm,
  onDismiss,
}: {
  proposal: TradeProposal;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const { order } = proposal;

  return (
    <li className="proposal">
      <div className="proposal-head">
        <strong>
          {MARKET_LABEL[order.instrument.market]} {order.instrument.symbol}
        </strong>
        <span>
          {order.side === Side.Buy ? "Buy" : "Sell"}{" "}
          {order.quantity.toLocaleString()} shares @{" "}
          {order.type === OrderType.Limit ? order.limitPrice : "market"}
        </span>
        <span className="muted">
          {proposal.source === ProposalSource.Agent ? "Agent" : "Manual"}
        </span>
        <span className={`status status-${proposal.status}`}>
          {STATUS_LABEL[proposal.status]}
        </span>
      </div>
      {proposal.rationale && <p className="muted">{proposal.rationale}</p>}
      {proposal.violations.length > 0 && (
        <ul className="violations">
          {proposal.violations.map((v) => (
            <li key={v.code}>{v.message}</li>
          ))}
        </ul>
      )}
      {proposal.error && <p className="error">{proposal.error}</p>}
      {proposal.status === ProposalStatus.AwaitingConfirmation && (
        <div className="actions">
          <button type="button" onClick={onConfirm}>
            Confirm and submit
          </button>
          <button type="button" className="secondary" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      )}
    </li>
  );
}
