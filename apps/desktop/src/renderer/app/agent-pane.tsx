import { Disclosure, Tabs } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { ProposalStatus } from "@solyx/core/order-desk";

import { ColumnHeader } from "../components/column-header.tsx";
import { AgentChat } from "../modules/agent/agent-chat.tsx";
import { agentSessionsQuery } from "../modules/agent/agent-query.ts";
import { AgentSessionControls } from "../modules/agent/agent-sessions.tsx";
import { useAgentStore } from "../modules/agent/agent-store.ts";
import { ProposalForm } from "../modules/proposals/proposal-form.tsx";
import { ProposalQueue } from "../modules/proposals/proposal-queue.tsx";
import { proposalsQuery } from "../modules/proposals/proposals-query.ts";

const AgentTab = {
  Chat: "chat",
  Proposals: "proposals",
} as const;

type AgentTab = (typeof AgentTab)[keyof typeof AgentTab];

/**
 * The conversation with the agent, and the proposals waiting for the user to confirm them. A
 * proposal the agent makes also shows in the conversation where it was made.
 */
export function AgentPane() {
  const { t } = useTranslation();
  const selected = useAgentStore((state) => state.selected);
  const sessions = useQuery(agentSessionsQuery());
  const proposals = useQuery(proposalsQuery());

  const sessionId =
    selected === undefined ? (sessions.data?.[0]?.id ?? null) : selected;

  const awaiting =
    proposals.data?.filter(
      (proposal) => proposal.status === ProposalStatus.AwaitingConfirmation
    ).length ?? 0;

  return (
    <div className="flex h-full flex-col">
      <ColumnHeader>
        <h2 className="text-sm font-semibold">{t("agent.title")}</h2>
        <AgentSessionControls sessionId={sessionId} />
      </ColumnHeader>
      <Tabs
        variant="secondary"
        defaultSelectedKey={AgentTab.Chat}
        className="flex min-h-0 flex-1 flex-col gap-0">
        <Tabs.ListContainer className="shrink-0 border-separator px-2">
          <Tabs.List aria-label={t("agent.title")}>
            {Object.values(AgentTab).map((tab: AgentTab) => (
              <Tabs.Tab key={tab} id={tab} className="h-10">
                {t(`agent.tabs.${tab}`)}
                {tab === AgentTab.Proposals && awaiting > 0 ? (
                  <span className="ml-1 text-xs tabular-nums">{awaiting}</span>
                ) : null}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id={AgentTab.Chat} className="min-h-0 flex-1 p-0">
          <AgentChat sessionId={sessionId} />
        </Tabs.Panel>
        <Tabs.Panel
          id={AgentTab.Proposals}
          className="flex min-h-0 flex-1 flex-col p-0">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ProposalQueue />
          </div>
          <Disclosure className="max-h-[70%] shrink-0 overflow-y-auto border-t border-separator">
            <Disclosure.Heading>
              <Disclosure.Trigger className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium">
                {t("proposals.form-title")}
                <Disclosure.Indicator className="ml-auto" />
              </Disclosure.Trigger>
            </Disclosure.Heading>
            <Disclosure.Content>
              <div className="flex flex-col gap-3 px-4 pb-4">
                <p className="text-xs text-muted">
                  {t("proposals.form-description")}
                </p>
                <ProposalForm />
              </div>
            </Disclosure.Content>
          </Disclosure>
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
