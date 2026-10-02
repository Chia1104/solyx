import { Button, Form, TextArea, TextField } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { emptyAgentView } from "@solyx/agent/wire";

import type { AgentFocus } from "#shared/ipc/agent.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { SendIcon, StopIcon } from "../../components/icons.tsx";

import { agentQueryKeys } from "./agent-query.ts";
import { useAgentStore } from "./agent-store.ts";

// An empty message only disables sending, so it needs no message of its own.
const composerSchema = z.object({ text: z.string().trim().min(1) });

/**
 * Writes to the conversation on screen, starting one when there is none. Enter sends and
 * Shift+Enter breaks the line; Enter that confirms an input method's composition does neither.
 */
export function AgentComposer({
  sessionId,
  running,
  focus,
}: {
  sessionId: string | null;
  running: boolean;
  focus: AgentFocus | null;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const select = useAgentStore((state) => state.select);

  const form = useForm({
    resolver: zodResolver(composerSchema),
    defaultValues: { text: "" },
  });

  const text = useWatch({ control: form.control, name: "text" });

  const send = useMutation({
    mutationFn: async (message: string) => {
      let id = sessionId;

      if (id === null) {
        ({ id } = await window.solyx.agent.createSession());
        // Seeded before it is shown, so the run's first events fold in without a fetch.
        queryClient.setQueryData(
          agentQueryKeys.transcript(id),
          emptyAgentView()
        );
        select(id);
      }

      await window.solyx.agent.send(id, message, focus, i18n.language);
    },
    onSuccess: () => form.reset(),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: agentQueryKeys.sessions }),
  });

  const abort = useMutation({
    mutationFn: (id: string) => window.solyx.agent.abort(id),
  });

  const submit = form.handleSubmit((values) => send.mutate(values.text));

  return (
    <Form
      validationBehavior="aria"
      className="flex shrink-0 flex-col gap-2 border-t border-separator p-3"
      onSubmit={(event) => void submit(event)}>
      <Controller
        control={form.control}
        name="text"
        render={({ field }) => (
          <TextField aria-label={t("agent.placeholder")} className="w-full">
            <TextArea
              {...field}
              rows={3}
              className="resize-none text-sm"
              placeholder={t("agent.placeholder")}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();

                  if (!running) void submit();
                }
              }}
            />
          </TextField>
        )}
      />
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted">
          {focus
            ? [focus.symbol.market, focus.symbol.symbol, focus.name]
                .filter(Boolean)
                .join(" ")
            : null}
        </span>
        {running && sessionId !== null ? (
          <Button
            size="sm"
            variant="tertiary"
            isPending={abort.isPending}
            onPress={() => abort.mutate(sessionId)}>
            <StopIcon />
            {t("agent.stop")}
          </Button>
        ) : (
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            isPending={send.isPending}
            isDisabled={!text.trim()}>
            <SendIcon />
            {t("agent.send")}
          </Button>
        )}
      </div>
      {send.error ? (
        <ErrorAlert
          title={t("agent.send-failed")}
          description={send.error.message}
        />
      ) : null}
    </Form>
  );
}
