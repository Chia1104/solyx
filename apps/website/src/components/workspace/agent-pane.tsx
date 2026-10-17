import { useEffect, useRef, useState } from "react";

import { Check, LoaderCircle, Plus, SendHorizontal } from "lucide-react";

import {
  agent,
  magi,
  proposals,
  status as statuses,
} from "@solyx/i18n/desktop/en-US.json";

import { price } from "./format.ts";
import type { Listing } from "./listings.ts";
import { Ask, Vote, prompts } from "./script.ts";
import type { Forecast, Proposal, Turn } from "./script.ts";

/** A proposal's status, named as the app names them. */
export const ProposalStatus = {
  AwaitingConfirmation: "awaiting-confirmation",
  Submitting: "submitting",
  Submitted: "submitted",
  Dismissed: "dismissed",
} as const;

export type ProposalStatus =
  (typeof ProposalStatus)[keyof typeof ProposalStatus];

const Tab = {
  Chat: "chat",
  Proposals: "proposals",
} as const;

type Tab = (typeof Tab)[keyof typeof Tab];

export interface AgentPaneProps {
  listing: Listing;
  turn: Turn | null;
  /** How many of the turn's tool calls have finished. */
  stepsDone: number;
  replied: boolean;
  status: ProposalStatus;
  onAsk: (ask: Ask) => void;
  onConfirm: () => void;
  onDismiss: () => void;
  onReset: () => void;
}

export function AgentPane({
  listing,
  turn,
  stepsDone,
  replied,
  status,
  onAsk,
  onConfirm,
  onDismiss,
  onReset,
}: AgentPaneProps) {
  const [tab, setTab] = useState<Tab>(Tab.Chat);
  const messagesRef = useRef<HTMLDivElement>(null);

  // Follow the conversation as tool calls finish and cards change.
  useEffect(() => {
    const messages = messagesRef.current;

    if (messages) messages.scrollTop = messages.scrollHeight;
  }, [turn, stepsDone, replied, status, tab]);
  const proposal = replied ? turn?.proposal : undefined;
  const waiting = proposal && status === ProposalStatus.AwaitingConfirmation;
  const questions = prompts(listing);

  return (
    <section
      aria-label="Agent"
      className="flex h-[36rem] min-h-0 flex-col lg:h-auto">
      <header className="flex items-center justify-between px-4 pt-3">
        <h3 className="text-sm font-semibold">{agent.title}</h3>
        <button
          type="button"
          onClick={onReset}
          aria-label={agent["new-chat"]}
          className="hover:bg-sheet-2 hover:text-text focus-visible:outline-ink grid size-7 place-items-center rounded-md text-muted focus-visible:outline-2">
          <Plus className="size-4" />
        </button>
      </header>

      <div
        role="tablist"
        className="border-rule mx-4 mt-2 grid grid-cols-2 border-b text-sm">
        {[Tab.Chat, Tab.Proposals].map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className="aria-selected:border-ink aria-selected:text-text focus-visible:outline-ink -mb-px border-b-2 border-transparent py-2 text-muted focus-visible:outline-2">
            {agent.tabs[name]}
            {name === Tab.Proposals && waiting && (
              <span className="bg-sheet-3 text-text ml-1.5 rounded-sm px-1.5 text-xs">
                1
              </span>
            )}
          </button>
        ))}
      </div>

      <div
        ref={messagesRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        aria-live="polite">
        {tab === Tab.Proposals ? (
          proposal ? (
            <ProposalCard
              listing={listing}
              proposal={proposal}
              status={status}
              onConfirm={onConfirm}
              onDismiss={onDismiss}
            />
          ) : (
            <p className="text-sm text-muted">
              Nothing waits for you. Proposals the agent drafts show up here.
            </p>
          )
        ) : turn ? (
          <div className="flex flex-col gap-4 text-sm">
            <p className="bg-sheet-3 ml-8 self-end rounded-md px-3 py-2">
              {turn.prompt}
            </p>
            <ul className="flex flex-col gap-1.5">
              {turn.steps.map((step, index) =>
                index > stepsDone ? null : (
                  <li key={step.label} className="flex items-center gap-2">
                    {index < stepsDone ? (
                      <Check
                        aria-label="Done"
                        className="size-3.5 text-muted"
                      />
                    ) : (
                      <LoaderCircle
                        aria-label="Running"
                        className="size-3.5 animate-spin text-muted motion-reduce:animate-none"
                      />
                    )}
                    <span>{step.label}</span>
                    <span className="text-muted">{step.detail}</span>
                  </li>
                )
              )}
            </ul>
            {replied && (
              <>
                <p className="leading-relaxed">{turn.reply}</p>
                {turn.forecast && <ForecastCard forecast={turn.forecast} />}
                {turn.proposal && (
                  <ProposalCard
                    listing={listing}
                    proposal={turn.proposal}
                    status={status}
                    onConfirm={onConfirm}
                    onDismiss={onDismiss}
                  />
                )}
              </>
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col justify-end gap-1 pb-2">
            <p className="font-medium">{agent["empty-title"]}</p>
            <p className="text-sm leading-relaxed text-muted">
              {agent["empty-description"]}
            </p>
          </div>
        )}
      </div>

      <div className="border-rule flex flex-col gap-2 border-t p-3">
        {(!turn || replied) && (
          <div className="flex flex-col gap-1.5">
            {[Ask.Forecast, Ask.Proposal].map((ask) => (
              <button
                key={ask}
                type="button"
                onClick={() => {
                  setTab(Tab.Chat);
                  onAsk(ask);
                }}
                className="border-rule bg-sheet hover:bg-sheet-2 focus-visible:outline-ink flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm focus-visible:outline-2">
                {questions[ask]}
                <SendHorizontal
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted"
                />
              </button>
            ))}
          </div>
        )}
        <div className="border-rule bg-sheet-2 flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted">
          <span className="bg-sheet-3 text-text rounded-sm px-1.5 py-0.5 text-xs">
            {listing.code} {listing.name}
          </span>
          <span className="truncate">The demo answers the questions above</span>
        </div>
      </div>
    </section>
  );
}

function ForecastCard({ forecast }: { forecast: Forecast }) {
  return (
    <article className="rounded-md pencil p-3 [--hatch-color:color-mix(in_oklab,var(--graphite)_18%,transparent)]">
      <header className="flex justify-between gap-2 text-xs text-muted">
        <span>
          Forecast, {forecast.sessions} sessions from {price(forecast.from)}
        </span>
        <span>Open</span>
      </header>
      <ul className="mt-3 flex flex-col gap-3">
        {forecast.scenarios.map((scenario) => (
          <li key={scenario.label}>
            <div className="flex items-baseline justify-between gap-2">
              <span>{scenario.label}</span>
              <span className="shrink-0">
                <span className="font-medium">
                  {Math.round(scenario.probability * 100)}%
                </span>{" "}
                <span className="text-xs text-muted">
                  history {Math.round(scenario.history * 100)}%
                </span>
              </span>
            </div>
            <div className="bg-sheet-3 relative mt-1 h-1.5 rounded-full">
              <div
                className="bg-graphite h-full rounded-full"
                style={{ width: `${scenario.probability * 100}%` }}
              />
              <div
                aria-hidden="true"
                className="bg-text absolute -top-0.5 h-2.5 w-0.5"
                style={{ left: `${scenario.history * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </article>
  );
}

interface ProposalCardProps {
  listing: Listing;
  proposal: Proposal;
  status: ProposalStatus;
  onConfirm: () => void;
  onDismiss: () => void;
}

/** Drafted in pencil until it is confirmed, when it turns to ink. */
function ProposalCard({
  listing,
  proposal,
  status,
  onConfirm,
  onDismiss,
}: ProposalCardProps) {
  const approvals = proposal.votes.filter(
    (vote) => vote.vote === Vote.Approves
  ).length;

  const signed = status === ProposalStatus.Submitted;

  return (
    <article
      data-status={status}
      className="group border-graphite/70 data-[status=submitted]:border-ink relative rounded-md border border-dashed p-3 transition-colors duration-500 data-[status=dismissed]:opacity-60 data-[status=submitted]:border-solid">
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-md hatch opacity-100 transition-opacity duration-700 [--hatch-color:color-mix(in_oklab,var(--graphite)_20%,transparent)] group-data-[status=submitted]:opacity-0"
      />
      <div
        aria-hidden="true"
        className="bg-ink/8 absolute inset-0 rounded-md opacity-0 transition-opacity duration-700 group-data-[status=submitted]:opacity-100"
      />

      <div className="relative">
        <header className="flex justify-between gap-2 text-xs">
          <span className="text-muted">Order proposal</span>
          <span className={signed ? "text-ink" : "text-muted"}>
            {statuses[status]}
          </span>
        </header>
        <p className="mt-2 text-base font-semibold">
          Buy {price(proposal.quantity)} shares @ {price(proposal.price)}
        </p>
        <p className="text-xs text-muted">
          {listing.code} {listing.name}, limit order, paper account
        </p>

        <ul className="mt-3 flex flex-col gap-1">
          {proposal.checks.map((check) => (
            <li key={check} className="flex items-start gap-2">
              <Check
                aria-hidden="true"
                className="mt-0.5 size-3.5 shrink-0 text-muted"
              />
              {check}
            </li>
          ))}
        </ul>

        <div className="border-graphite/50 mt-3 border-t border-dashed pt-3">
          <p className="flex items-baseline justify-between">
            <span className="font-mincho text-base font-bold">MAGI</span>
            <span className="text-xs">
              {magi.carried},{" "}
              {magi.tally
                .replace("{{approved, number}}", String(approvals))
                .replace(
                  "{{rejected, number}}",
                  String(proposal.votes.length - approvals)
                )}
            </span>
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {proposal.votes.map((vote) => (
              <li
                key={vote.unit}
                className="grid grid-cols-[6.5rem_1fr] gap-x-2 text-xs">
                <span className="font-medium tracking-wide">{vote.unit}</span>
                <span>
                  <span
                    className={
                      vote.vote === Vote.Approves
                        ? "bg-text text-paper rounded-sm px-1"
                        : "border-graphite/60 rounded-sm border px-1"
                    }>
                    {vote.vote === Vote.Approves
                      ? magi.votes.approve
                      : magi.votes.reject}
                  </span>{" "}
                  <span className="text-muted">{vote.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {status === ProposalStatus.AwaitingConfirmation && (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={onConfirm}
              className="bg-ink text-ink-text focus-visible:outline-ink h-8 rounded-md px-3 font-medium transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.97] motion-reduce:transition-none">
              {proposals.confirm}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="border-rule bg-sheet hover:bg-sheet-2 focus-visible:outline-ink h-8 rounded-md border px-3 font-medium focus-visible:outline-2">
              {proposals.dismiss}
            </button>
          </div>
        )}
        {status === ProposalStatus.Submitting && (
          <p className="mt-4 flex items-center gap-2 text-xs text-muted">
            <LoaderCircle
              aria-hidden="true"
              className="size-3.5 animate-spin motion-reduce:animate-none"
            />
            Running the risk checks again
          </p>
        )}
        {signed && (
          <p className="text-ink mt-4 text-xs">
            The checks passed again, and the order went to the paper account.
          </p>
        )}
      </div>
    </article>
  );
}
