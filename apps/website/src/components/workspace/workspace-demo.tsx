import { useEffect, useMemo, useState } from "react";

import { ClientOnly } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { twTickSize } from "@solyx/core/rules/tw";

import { prefersReducedMotion } from "../../lib/motion.ts";

import { AgentPane, ProposalStatus } from "./agent-pane.tsx";
import { percent, price } from "./format.ts";
import { LISTINGS, candlesFor, sessionChange } from "./listings.ts";
import { PriceChart } from "./price-chart.tsx";
import { turnFor } from "./script.ts";
import type { Ask, Turn } from "./script.ts";
import { Watchlist } from "./watchlist.tsx";

const STEP_MS = 650;

const SUBMIT_MS = 900;

/** The app's workspace on made-up prices: a watchlist, a daily chart and the agent. */
export function WorkspaceDemo() {
  const { t } = useTranslation();

  const listings = useMemo(
    () =>
      LISTINGS.map((listing) => ({ listing, candles: candlesFor(listing) })),
    []
  );

  const [code, setCode] = useState(listings[0].listing.code);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [stepsDone, setStepsDone] = useState(0);

  const [status, setStatus] = useState<ProposalStatus>(
    ProposalStatus.AwaitingConfirmation
  );

  const current =
    listings.find((entry) => entry.listing.code === code) ?? listings[0];

  const { listing, candles } = current;
  const replied = turn !== null && stepsDone >= turn.steps.length;

  // Each tool call finishes in turn, then the reply arrives; reduced motion shows them at once.
  useEffect(() => {
    if (!turn || stepsDone >= turn.steps.length) return;

    if (prefersReducedMotion()) {
      setStepsDone(turn.steps.length);

      return;
    }

    const timer = setTimeout(() => setStepsDone(stepsDone + 1), STEP_MS);

    return () => clearTimeout(timer);
  }, [turn, stepsDone]);

  useEffect(() => {
    if (status !== ProposalStatus.Submitting) return;

    const timer = setTimeout(
      () => setStatus(ProposalStatus.Submitted),
      SUBMIT_MS
    );

    return () => clearTimeout(timer);
  }, [status]);

  const reset = () => {
    setTurn(null);
    setStepsDone(0);
    setStatus(ProposalStatus.AwaitingConfirmation);
  };

  const ask = (question: Ask) => {
    setStepsDone(0);
    setStatus(ProposalStatus.AwaitingConfirmation);
    setTurn(turnFor(question, listing, candles));
  };

  // A conversation carries the listing on screen, so another listing starts a new one.
  const select = (next: string) => {
    if (next === code) return;

    setCode(next);
    reset();
  };

  const proposal = replied ? turn?.proposal : undefined;

  const limit =
    proposal && status !== ProposalStatus.Dismissed
      ? { price: proposal.price, signed: status === ProposalStatus.Submitted }
      : undefined;

  const session = sessionChange(candles);
  const rising = session.change > 0;

  return (
    <div className="bg-card overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-3 border-b border-border bg-muted px-4 py-2.5 text-xs">
        <span aria-hidden="true" className="flex gap-1.5">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </span>
        <span className="font-semibold">Solyx</span>
        <span className="text-muted-foreground ml-auto">
          {t("demo.market-closed")}
        </span>
        <span className="rounded-sm pencil px-2 py-0.5 font-medium">
          {t("demo.paper-trading")}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:h-[42rem] lg:grid-cols-[13rem_minmax(0,1fr)_22rem]">
        <div className="border-b border-border lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-b-0">
          <Watchlist listings={listings} selected={code} onSelect={select} />
        </div>

        <div className="flex min-w-0 flex-col border-b border-border lg:min-h-0 lg:border-r lg:border-b-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3">
            <h3 className="font-semibold">
              {listing.code} {listing.name}
            </h3>
            <span className="text-muted-foreground text-xs">
              {t("demo.market")}
            </span>
            <span className="text-lg font-semibold">{price(listing.last)}</span>
            <span className={`text-sm ${rising ? "text-rise" : "text-fall"}`}>
              {rising ? "+" : ""}
              {price(session.change)} {percent(session.ratio)}
            </span>
            <span className="text-muted-foreground ml-auto text-xs">
              {t("demo.daily")}
            </span>
          </div>
          <ClientOnly fallback={<div className="h-80 lg:h-auto lg:flex-1" />}>
            <PriceChart
              className="h-80 lg:h-auto lg:min-h-0 lg:flex-1"
              candles={candles}
              tick={twTickSize(listing.last, listing.code)}
              forecast={replied ? turn?.forecast : undefined}
              limit={limit}
            />
          </ClientOnly>
        </div>

        <AgentPane
          listing={listing}
          turn={turn}
          stepsDone={stepsDone}
          replied={replied}
          status={status}
          onAsk={ask}
          onConfirm={() => setStatus(ProposalStatus.Submitting)}
          onDismiss={() => setStatus(ProposalStatus.Dismissed)}
          onReset={reset}
        />
      </div>
    </div>
  );
}
