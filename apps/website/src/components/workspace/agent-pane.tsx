import { useEffect, useRef, useState } from "react";

import { Check, LoaderCircle, Plus, SendHorizontal } from "lucide-react";

import {
  agent,
  magi,
  proposals,
  status as statuses,
} from "@solyx/i18n/desktop/en-US.json";

import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.tsx";

import { price } from "./format.ts";
import type { Listing } from "./listings.ts";
import { Ask, Vote, prompts } from "./script.ts";
import type { Forecast, Proposal, Turn } from "./script.ts";

// New messages rise into place; reduced motion keeps only the fade.
const ENTER =
  "transition-[opacity,translate] duration-200 ease-out starting:opacity-0 starting:translate-y-1.5 motion-reduce:starting:translate-y-0";

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
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onReset}
          aria-label={agent["new-chat"]}
          className="text-muted-foreground">
          <Plus />
        </Button>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
        <TabsList
          variant="line"
          className="mx-4 mt-2 grid h-auto w-auto grid-cols-2 rounded-none border-b border-border p-0">
          {[Tab.Chat, Tab.Proposals].map((name) => (
            <TabsTrigger
              key={name}
              value={name}
              className="after:bg-primary h-auto rounded-none py-2 group-data-horizontal/tabs:after:-bottom-px">
              {agent.tabs[name]}
              {name === Tab.Proposals && waiting && (
                <Badge variant="secondary">1</Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <div
          ref={messagesRef}
          className="min-h-0 flex-1 overflow-y-auto scroll-smooth px-4 py-4 motion-reduce:scroll-auto"
          aria-live="polite">
          <TabsContent value={Tab.Proposals}>
            {proposal ? (
              <ProposalCard
                listing={listing}
                proposal={proposal}
                status={status}
                onConfirm={onConfirm}
                onDismiss={onDismiss}
              />
            ) : (
              <p className="text-muted-foreground">
                Nothing waits for you. Proposals the agent drafts show up here.
              </p>
            )}
          </TabsContent>
          <TabsContent value={Tab.Chat} className="h-full">
            {turn ? (
              // Keyed by the question, so the empty state's nodes are not reused and a new question's messages enter.
              <div key={turn.prompt} className="flex flex-col gap-4 text-sm">
                <p
                  className={`ml-8 self-end rounded-md bg-accent px-3 py-2 ${ENTER}`}>
                  {turn.prompt}
                </p>
                <ul className="flex flex-col gap-1.5">
                  {turn.steps.map((step, index) =>
                    index > stepsDone ? null : (
                      <li
                        key={step.label}
                        className={`flex items-center gap-2 ${ENTER}`}>
                        {index < stepsDone ? (
                          <Check
                            aria-label="Done"
                            className="text-muted-foreground size-3.5"
                          />
                        ) : (
                          <LoaderCircle
                            aria-label="Running"
                            className="text-muted-foreground size-3.5 animate-spin motion-reduce:animate-none"
                          />
                        )}
                        <span>{step.label}</span>
                        <span className="text-muted-foreground">
                          {step.detail}
                        </span>
                      </li>
                    )
                  )}
                </ul>
                {replied && (
                  <>
                    <p className={`leading-relaxed ${ENTER}`}>{turn.reply}</p>
                    {turn.forecast && (
                      <div className={`${ENTER} delay-60`}>
                        <ForecastCard forecast={turn.forecast} />
                      </div>
                    )}
                    {turn.proposal && (
                      <div className={`${ENTER} delay-120`}>
                        <ProposalCard
                          listing={listing}
                          proposal={turn.proposal}
                          status={status}
                          onConfirm={onConfirm}
                          onDismiss={onDismiss}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="flex h-full flex-col justify-end gap-1 pb-2">
                <p className="font-medium">{agent["empty-title"]}</p>
                <p className="text-muted-foreground leading-relaxed">
                  {agent["empty-description"]}
                </p>
              </div>
            )}
          </TabsContent>
        </div>
      </Tabs>

      <div className="flex flex-col gap-2 border-t border-border p-3">
        {(!turn || replied) && (
          <div className="flex flex-col gap-1.5">
            {[Ask.Forecast, Ask.Proposal].map((ask) => (
              <Button
                key={ask}
                variant="outline"
                onClick={() => {
                  setTab(Tab.Chat);
                  onAsk(ask);
                }}
                className="h-auto justify-between px-3 py-2 text-left font-normal whitespace-normal">
                {questions[ask]}
                <SendHorizontal
                  aria-hidden="true"
                  className="text-muted-foreground"
                />
              </Button>
            ))}
          </div>
        )}
        <div className="text-muted-foreground flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm">
          <Badge variant="secondary" className="bg-accent">
            {listing.code} {listing.name}
          </Badge>
          <span className="truncate">The demo answers the questions above</span>
        </div>
      </div>
    </section>
  );
}

function ForecastCard({ forecast }: { forecast: Forecast }) {
  return (
    <article className="rounded-md pencil p-3 [--hatch-color:color-mix(in_oklab,var(--graphite)_18%,transparent)]">
      <header className="text-muted-foreground flex justify-between gap-2 text-xs">
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
                <span className="text-muted-foreground text-xs">
                  history {Math.round(scenario.history * 100)}%
                </span>
              </span>
            </div>
            <div className="relative mt-1 h-1.5 rounded-full bg-accent">
              <div
                className="bg-graphite h-full rounded-full"
                style={{ width: `${scenario.probability * 100}%` }}
              />
              <div
                aria-hidden="true"
                className="absolute -top-0.5 h-2.5 w-0.5 bg-foreground"
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
      className="group border-graphite/70 relative rounded-md border border-dashed p-3 transition-opacity duration-200 ease-out data-[status=dismissed]:opacity-60">
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-md hatch [--hatch-color:color-mix(in_oklab,var(--graphite)_20%,transparent)] motion-safe:transition-[clip-path] motion-safe:duration-600 motion-safe:ease-in-out motion-safe:[clip-path:inset(0_0_0_0)] motion-safe:group-data-[status=submitted]:[clip-path:inset(0_0_0_100%)] motion-reduce:transition-opacity motion-reduce:duration-200 motion-reduce:ease-out motion-reduce:group-data-[status=submitted]:opacity-0"
      />
      {/* Signing lays ink over the pencil, its solid outline covering the dashed one; the hatching gives way at the same edge. */}
      <div
        aria-hidden="true"
        className="border-primary bg-primary/8 absolute -inset-px rounded-md border motion-safe:transition-[clip-path] motion-safe:duration-600 motion-safe:ease-in-out motion-safe:[clip-path:inset(0_100%_0_0_round_var(--radius-md))] motion-safe:group-data-[status=submitted]:[clip-path:inset(0_0_0_0_round_var(--radius-md))] motion-reduce:opacity-0 motion-reduce:transition-opacity motion-reduce:duration-200 motion-reduce:ease-out motion-reduce:group-data-[status=submitted]:opacity-100"
      />

      <div className="relative">
        <header className="flex justify-between gap-2 text-xs">
          <span className="text-muted-foreground">Order proposal</span>
          <span
            key={status}
            className={`transition-[opacity,filter] duration-200 ease-out starting:opacity-0 starting:blur-[2px] ${signed ? "text-primary" : "text-muted-foreground"}`}>
            {statuses[status]}
          </span>
        </header>
        <p className="mt-2 text-base font-semibold">
          Buy {price(proposal.quantity)} shares @ {price(proposal.price)}
        </p>
        <p className="text-muted-foreground text-xs">
          {listing.code} {listing.name}, limit order, paper account
        </p>

        <ul className="mt-3 flex flex-col gap-1">
          {proposal.checks.map((check) => (
            <li key={check} className="flex items-start gap-2">
              <Check
                aria-hidden="true"
                className="text-muted-foreground mt-0.5 size-3.5 shrink-0"
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
                        ? "rounded-sm bg-foreground px-1 text-background"
                        : "border-graphite/60 rounded-sm border px-1"
                    }>
                    {vote.vote === Vote.Approves
                      ? magi.votes.approve
                      : magi.votes.reject}
                  </span>{" "}
                  <span className="text-muted-foreground">{vote.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {status === ProposalStatus.AwaitingConfirmation && (
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={onConfirm}>
              {proposals.confirm}
            </Button>
            <Button variant="outline" size="sm" onClick={onDismiss}>
              {proposals.dismiss}
            </Button>
          </div>
        )}
        {status === ProposalStatus.Submitting && (
          <p className="text-muted-foreground mt-4 flex items-center gap-2 text-xs transition-opacity duration-200 ease-out starting:opacity-0">
            <LoaderCircle
              aria-hidden="true"
              className="size-3.5 animate-spin motion-reduce:animate-none"
            />
            Running the risk checks again
          </p>
        )}
        {signed && (
          <p className="text-primary mt-4 text-xs transition-opacity duration-200 ease-out starting:opacity-0">
            The checks passed again, and the order went to the paper account.
          </p>
        )}
      </div>
    </article>
  );
}
