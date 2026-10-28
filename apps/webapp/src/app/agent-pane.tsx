import { Tabs, cn } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { ProposalStatus } from "@solyx/core/order-desk";
import { isEnumValue } from "@solyx/utils/is";

import { FillList } from "../modules/account/fills-table.tsx";
import { ProfitLoss } from "../modules/account/profit-loss.tsx";
import { WorkingOrderList } from "../modules/account/working-orders.tsx";
import { AgentChat } from "../modules/agent/agent-chat.tsx";
import { agentSessionsQuery } from "../modules/agent/agent-query.ts";
import { AgentSessionControls } from "../modules/agent/agent-sessions.tsx";
import { AgentTab, useAgentStore } from "../modules/agent/agent-store.ts";
import { OrderTicket } from "../modules/proposals/order-ticket.tsx";
import {
  PendingProposals,
  ProposalHistory,
} from "../modules/proposals/proposal-queue.tsx";
import { proposalsQuery } from "../modules/proposals/proposals-query.ts";

const PANEL = "min-h-0 flex-1 overflow-y-auto p-0";

/**
 * The conversation with the agent and trading, as one row of tabs: the conversation with the
 * controls over which one, what waits on the user or the broker, the order panel, and what the
 * account holds and has made. A proposal the agent makes also shows in the conversation where it
 * was made.
 */
export function AgentPane() {
  const { t } = useTranslation();
  const selected = useAgentStore((state) => state.selected);
  const tab = useAgentStore((state) => state.tab);
  const showTab = useAgentStore((state) => state.showTab);
  const sessions = useQuery(agentSessionsQuery());
  const proposals = useQuery(proposalsQuery());

  const sessionId =
    selected === undefined ? (sessions.data?.[0]?.id ?? null) : selected;

  const awaiting =
    proposals.data?.filter(
      (proposal) => proposal.status === ProposalStatus.AwaitingConfirmation
    ).length ?? 0;

  return (
    <Tabs
      selectedKey={tab}
      onSelectionChange={(key) => {
        if (isEnumValue(AgentTab, key)) showTab(key);
      }}
      className="relative flex h-full flex-col gap-0">
      {/* The pane's header row is its tabs, as tall as every column's header so they line up. */}
      <Tabs.ListContainer className="my-1 shrink-0 self-start">
        <Tabs.List aria-label={t("agent.title")}>
          {Object.values(AgentTab).map((each: AgentTab) => (
            // HeroUI shares the row out evenly, which would break a label with a count between
            // its characters; one that needs more room takes it from the others.
            <Tabs.Tab
              key={each}
              id={each}
              className="h-7 px-3 whitespace-nowrap">
              {t(`agent.tabs.${each}`)}
              {each === AgentTab.Proposals && awaiting > 0 ? (
                <span className="ml-1 text-xs tabular-nums">{awaiting}</span>
              ) : null}
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
      {tab === AgentTab.Chat ? (
        <div className="absolute top-0 right-0 flex h-11 items-center">
          <AgentSessionControls sessionId={sessionId} />
        </div>
      ) : null}
      <Tabs.Panel id={AgentTab.Chat} className="min-h-0 flex-1 p-0">
        <AgentChat sessionId={sessionId} />
      </Tabs.Panel>
      <Tabs.Panel id={AgentTab.Proposals} className={PANEL}>
        <PendingProposals />
        <WorkingOrderList />
        <FillList />
        <ProposalHistory />
      </Tabs.Panel>
      {/* Kept mounted behind the other tabs, so a draft outlives a look at them. */}
      <Tabs.Panel
        id={AgentTab.Ticket}
        shouldForceMount
        className={cn(PANEL, "data-inert:hidden")}>
        <OrderTicket />
      </Tabs.Panel>
      <Tabs.Panel id={AgentTab.ProfitLoss} className={PANEL}>
        <ProfitLoss />
      </Tabs.Panel>
    </Tabs>
  );
}
