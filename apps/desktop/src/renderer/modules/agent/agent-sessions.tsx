import { useState } from "react";

import { AlertDialog, Button, Popover, ScrollShadow, cn } from "@heroui/react";
import {
  Add01Icon,
  Delete02Icon,
  Layers01Icon,
} from "@hugeicons/core-free-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { AgentSession } from "@solyx/agent/wire";

import { useClock } from "../../app/clock.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { Icon } from "../../components/icon.tsx";

import { agentQueryKeys, agentSessionsQuery } from "./agent-query.ts";
import { useAgentStore } from "./agent-store.ts";

/** Asks before a conversation is erased, naming it so it cannot be taken for another. */
function DeleteSessionDialog({
  session,
  isOpen,
  openId,
  onClose,
}: {
  session: AgentSession | null;
  isOpen: boolean;
  /** The conversation on screen, which a new one replaces once it is deleted. */
  openId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const select = useAgentStore((state) => state.select);

  const remove = useMutation({
    mutationFn: (id: string) => window.solyx.agent.deleteSession(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: agentQueryKeys.transcript(id) });

      if (id === openId) select(null);

      onClose();
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: agentQueryKeys.sessions }),
  });

  const close = () => {
    remove.reset();
    onClose();
  };

  return (
    <AlertDialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && !remove.isPending) close();
      }}>
      <AlertDialog.Backdrop>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-sm">
            <AlertDialog.Header>
              <AlertDialog.Heading>
                {t("agent.delete-title")}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="flex flex-col gap-3">
              <p className="truncate rounded-sm bg-surface-secondary px-3 py-2 text-sm font-medium text-foreground">
                {session?.title || t("agent.untitled")}
              </p>
              <p className="text-sm text-muted">
                {t("agent.delete-description")}
              </p>
              {remove.error ? (
                <ErrorAlert
                  title={t("agent.delete-failed")}
                  description={remove.error.message}
                />
              ) : null}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                variant="tertiary"
                isDisabled={remove.isPending}
                onPress={close}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="danger"
                isPending={remove.isPending}
                onPress={() => {
                  if (session) remove.mutate(session.id);
                }}>
                {t("agent.delete")}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}

/** Earlier conversations to switch to or delete, and starting a new one. */
export function AgentSessionControls({
  sessionId,
}: {
  sessionId: string | null;
}) {
  const { t } = useTranslation();
  const clock = useClock();
  const select = useAgentStore((state) => state.select);
  const { data: sessions = [] } = useQuery(agentSessionsQuery());
  const [listOpen, setListOpen] = useState(false);
  // Kept after the dialog closes, so it still names the conversation while it fades out.
  const [target, setTarget] = useState<AgentSession | null>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="ml-auto flex items-center gap-1">
      <Popover isOpen={listOpen} onOpenChange={setListOpen}>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={t("agent.conversations")}
          isDisabled={sessions.length === 0}>
          <Icon icon={Layers01Icon} />
        </Button>
        <Popover.Content placement="bottom end" className="w-72">
          <Popover.Dialog className="flex flex-col p-1">
            <Popover.Heading className="px-2 pt-1 pb-1.5 text-xs text-muted">
              {t("agent.conversations")}
            </Popover.Heading>
            <ScrollShadow size={24} className="max-h-80">
              <ul className="flex flex-col gap-0.5">
                {sessions.map((session) => {
                  const open = session.id === sessionId;
                  const title = session.title || t("agent.untitled");

                  return (
                    <li key={session.id} className="group/row relative">
                      <Button
                        fullWidth
                        variant="ghost"
                        aria-current={open || undefined}
                        className={cn(
                          "h-auto min-w-0 flex-col items-start gap-0 py-1.5 pr-9 pl-2 text-left font-normal",
                          open && "bg-default"
                        )}
                        onPress={() => {
                          select(session.id);
                          setListOpen(false);
                        }}>
                        <span className="w-full truncate text-sm">{title}</span>
                        <time
                          dateTime={new Date(session.updatedAt).toISOString()}
                          title={clock.fullTime(session.updatedAt)}
                          className="text-xs text-muted tabular-nums">
                          {clock.time(session.updatedAt)}
                        </time>
                      </Button>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="ghost"
                        aria-label={t("agent.delete-named", { title })}
                        className="absolute top-1/2 right-1 -translate-y-1/2 text-muted opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                        onPress={() => {
                          setListOpen(false);
                          setTarget(session);
                          setConfirming(true);
                        }}>
                        <Icon icon={Delete02Icon} className="size-3.5" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </ScrollShadow>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={t("agent.new-chat")}
        onPress={() => select(null)}>
        <Icon icon={Add01Icon} />
      </Button>
      <DeleteSessionDialog
        session={target}
        isOpen={confirming}
        openId={sessionId}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}
