import { useEffect } from "react";

import {
  Button,
  Chip,
  CloseButton,
  Form,
  TextArea,
  TextField,
  cn,
} from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { emptyAgentView } from "@solyx/agent/wire";
import { symbolKey } from "@solyx/core/market";

import type { AgentFocus } from "#shared/ipc/agent.ts";

import { currentLocale } from "../../app/i18n.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { CandlesIcon, SendIcon, StopIcon } from "../../components/icons.tsx";

import { agentQueryKeys } from "./agent-query.ts";
import { useAgentStore } from "./agent-store.ts";

// An empty message only disables sending, so it needs no message of its own.
const composerSchema = z.object({ text: z.string().trim().min(1) });

/** The listing on screen, sent with each message unless the user detaches it. */
function FocusAttachment({ focus }: { focus: AgentFocus }) {
  const { t } = useTranslation();
  const detachedFocus = useAgentStore((state) => state.detachedFocus);
  const setDetachedFocus = useAgentStore((state) => state.setDetachedFocus);

  const key = symbolKey(focus.symbol);
  const attached = key !== detachedFocus;
  const label = [focus.symbol.symbol, focus.name].filter(Boolean).join(" ");

  return (
    <div
      className={cn(
        "flex h-7 items-center gap-2 px-2 text-xs",
        !attached && "text-muted"
      )}>
      <CandlesIcon className="size-3.5 shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate">
        {attached ? label : t("agent.context.detached", { label })}
      </span>
      {attached ? (
        <>
          <Chip size="sm" variant="soft">
            {t(`market.${focus.symbol.market}`)}
          </Chip>
          <CloseButton
            aria-label={t("agent.context.detach", { label })}
            className="size-5"
            onPress={() => setDetachedFocus(key)}
          />
        </>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="h-5 px-1.5 text-xs"
          onPress={() => setDetachedFocus(null)}>
          {t("agent.context.attach")}
        </Button>
      )}
    </div>
  );
}

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
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const select = useAgentStore((state) => state.select);
  const detachedFocus = useAgentStore((state) => state.detachedFocus);
  const draft = useAgentStore((state) => state.draft);
  const setDraft = useAgentStore((state) => state.setDraft);

  const form = useForm({
    resolver: zodResolver(composerSchema),
    defaultValues: { text: "" },
  });

  const text = useWatch({ control: form.control, name: "text" });

  const attachedFocus =
    focus && symbolKey(focus.symbol) !== detachedFocus ? focus : null;

  // A message handed back for editing replaces what is being written.
  useEffect(() => {
    if (draft === null) return;

    form.setValue("text", draft);
    form.setFocus("text");
    setDraft(null);
  }, [draft, form, setDraft]);

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

      await window.solyx.agent.send(
        id,
        message,
        attachedFocus,
        currentLocale()
      );
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
      className="flex shrink-0 flex-col gap-2 px-3 pt-2 pb-3"
      onSubmit={(event) => void submit(event)}>
      {send.error ? (
        <ErrorAlert
          title={t("agent.send-failed")}
          description={send.error.message}
        />
      ) : null}
      <div className="flex flex-col">
        {focus ? (
          <div className="mx-2 rounded-t-sm border border-b-0 border-border bg-surface-secondary">
            <FocusAttachment focus={focus} />
          </div>
        ) : null}
        <div className="relative rounded-sm border border-border bg-surface shadow-xs transition-colors focus-within:border-field-border-focus">
          <Controller
            control={form.control}
            name="text"
            render={({ field }) => (
              <TextField aria-label={t("agent.placeholder")} className="w-full">
                <TextArea
                  {...field}
                  rows={1}
                  className="block field-sizing-content max-h-50 min-h-16 w-full resize-none rounded-none border-0 bg-transparent py-2 pr-10 pl-3 text-sm leading-6 shadow-none ring-0"
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
          <div className="absolute right-1.5 bottom-1.5">
            {running && sessionId !== null ? (
              <Button
                isIconOnly
                size="sm"
                variant="tertiary"
                aria-label={t("agent.stop")}
                isPending={abort.isPending}
                onPress={() => abort.mutate(sessionId)}>
                <StopIcon />
              </Button>
            ) : (
              <Button
                isIconOnly
                type="submit"
                size="sm"
                variant="secondary"
                aria-label={t("agent.send")}
                isPending={send.isPending}
                isDisabled={!text.trim()}>
                <SendIcon />
              </Button>
            )}
          </div>
        </div>
      </div>
    </Form>
  );
}
