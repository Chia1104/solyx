import { Button, Dropdown } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { HistoryIcon, PlusIcon } from "../../components/icons.tsx";

import { agentQueryKeys, agentSessionsQuery } from "./agent-query.ts";
import { useAgentStore } from "./agent-store.ts";

// Session ids are UUIDs, so this key never names one.
const DELETE_ACTION = "delete";

/** Earlier conversations to switch to, deleting the open one, and starting a new one. */
export function AgentSessionControls({
  sessionId,
}: {
  sessionId: string | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const select = useAgentStore((state) => state.select);
  const { data: sessions = [] } = useQuery(agentSessionsQuery());

  const remove = useMutation({
    mutationFn: (id: string) => window.solyx.agent.deleteSession(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: agentQueryKeys.transcript(id) });
      select(null);
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: agentQueryKeys.sessions }),
  });

  return (
    <div className="ml-auto flex items-center gap-1">
      <Dropdown>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={t("agent.conversations")}
          isDisabled={sessions.length === 0}>
          <HistoryIcon />
        </Button>
        <Dropdown.Popover
          placement="bottom end"
          className="max-h-80 w-64 overflow-y-auto">
          <Dropdown.Menu
            aria-label={t("agent.conversations")}
            onAction={(key) => {
              if (key === DELETE_ACTION) {
                if (sessionId !== null) remove.mutate(sessionId);
              } else {
                select(String(key));
              }
            }}>
            <Dropdown.Section>
              {sessions.map((session) => {
                const title = session.title || t("agent.untitled");

                return (
                  <Dropdown.Item
                    key={session.id}
                    id={session.id}
                    textValue={title}
                    className={
                      session.id === sessionId ? "font-medium" : undefined
                    }>
                    <span className="truncate">{title}</span>
                  </Dropdown.Item>
                );
              })}
            </Dropdown.Section>
            {sessionId !== null ? (
              <Dropdown.Section>
                <Dropdown.Item
                  id={DELETE_ACTION}
                  textValue={t("agent.delete")}
                  variant="danger">
                  {t("agent.delete")}
                </Dropdown.Item>
              </Dropdown.Section>
            ) : null}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={t("agent.new-chat")}
        onPress={() => select(null)}>
        <PlusIcon />
      </Button>
    </div>
  );
}
