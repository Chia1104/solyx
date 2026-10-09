import { useEffect, useRef, useState } from "react";

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
import {
  ArrowUp02Icon,
  ChartCandlestickIcon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Autocomplete } from "react-aria-components";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import type { AgentModelPick, AgentModelRef } from "@solyx/agent/providers";
import {
  AgentCommand,
  ApprovalMode,
  CompactionOutcome,
  emptyAgentView,
  messageCommand,
} from "@solyx/agent/wire";
import type { AgentView } from "@solyx/agent/wire";
import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import type { AgentSettings } from "#shared/ipc/settings.ts";
import { SettingsSection } from "#shared/settings-section.ts";

import { currentTimeZone } from "../../app/clock.ts";
import { currentLocale } from "../../app/i18n.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { Icon } from "../../components/icon.tsx";
import { listingName, useListingName } from "../market/listing-name.tsx";
import { listingQuery } from "../market/listing-query.ts";
import {
  agentSettingsQuery,
  isModelReady,
} from "../settings/settings-query.ts";

import { ApprovalModeMenu } from "./agent-approval-mode.tsx";
import { AgentModelPicker } from "./agent-model-picker.tsx";
import {
  agentQueryKeys,
  agentSessionsQuery,
  transcriptQuery,
} from "./agent-query.ts";
import { useAgentStore } from "./agent-store.ts";
import { ContextMeter } from "./agent-usage.tsx";
import {
  ComposerMenu,
  suggests,
  useComposerSuggestions,
} from "./composer-menu.tsx";
import type { ComposerSuggestion } from "./composer-menu.tsx";
import { ComposerTokenKind, replaceToken, tokenAt } from "./composer-token.ts";

// An empty message only disables sending, so it needs no message of its own.
const composerSchema = z.object({ text: z.string().trim().min(1) });

// Streaming replaces the transcript every frame, while the composer needs only this.
const progressOf = (view: AgentView) => ({
  context: view.context,
  /** A summary the user asked for is being written. */
  compacting: view.compactions.some((each) => each.manual),
});

/** The listing on screen, sent with each message unless the user detaches it. */
function FocusAttachment({ focus }: { focus: SymbolRef }) {
  const { t } = useTranslation();
  const name = useListingName(focus);
  const detachedFocus = useAgentStore((state) => state.detachedFocus);
  const setDetachedFocus = useAgentStore((state) => state.setDetachedFocus);

  const key = symbolKey(focus);
  const attached = key !== detachedFocus;
  const label = [focus.symbol, name].filter(Boolean).join(" ");

  return (
    <div
      className={cn(
        "flex h-7 items-center gap-2 px-2 text-xs",
        !attached && "text-muted"
      )}>
      <Icon
        icon={ChartCandlestickIcon}
        className="size-3.5 shrink-0 text-muted"
      />
      <span className="min-w-0 flex-1 truncate">
        {attached ? label : t("agent.context.detached", { label })}
      </span>
      {attached ? (
        <>
          <Chip size="sm" variant="soft">
            {t(`market.${focus.market}`)}
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

/** Why the conversation's model cannot run, with the way to the settings that would let it. */
function ModelUnavailable({
  settings,
  model,
}: {
  settings: AgentSettings;
  model: AgentModelRef;
}) {
  const { t } = useTranslation();

  const name =
    settings.models.find(
      (each) => each.provider === model.provider && each.id === model.id
    )?.name ?? model.id;

  const provider =
    settings.providers.find((each) => each.provider === model.provider)?.name ??
    model.provider;

  return (
    <p className="px-1 text-xs text-warning">
      {t("agent.model-unavailable", { model: name, provider })}{" "}
      <Link
        to="/settings"
        search={{ section: SettingsSection.Agent }}
        className="underline underline-offset-2">
        {t("agent.open-settings")}
      </Link>
    </p>
  );
}

/**
 * Writes to the conversation on screen, starting one when there is none, on a model that can run. Enter sends and
 * Shift+Enter breaks the line; Enter that confirms an input method's composition does neither. `@` suggests a
 * listing and a leading `/` a skill: while the list is open, Enter and Tab pick and Escape closes it.
 */
export function AgentComposer({
  sessionId,
  running,
  focus,
}: {
  sessionId: string | null;
  running: boolean;
  /** The listing on screen. */
  focus: SymbolRef | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const select = useAgentStore((state) => state.select);
  const detachedFocus = useAgentStore((state) => state.detachedFocus);
  const draft = useAgentStore((state) => state.draft);
  const setDraft = useAgentStore((state) => state.setDraft);
  const unstarted = useAgentStore((state) => state.unstarted);
  const setUnstarted = useAgentStore((state) => state.setUnstarted);

  const form = useForm({
    resolver: zodResolver(composerSchema),
    defaultValues: { text: "" },
  });

  const text = useWatch({ control: form.control, name: "text" });

  const input = useRef<HTMLTextAreaElement | null>(null);
  const [caret, setCaret] = useState(0);
  // The token Escape closed the menu on, which stays closed until the caret leaves it.
  const [dismissed, setDismissed] = useState<number | null>(null);

  // Chromium fires `selectionchange` at a textarea without bubbling, so React's `onSelect` misses it.
  useEffect(() => {
    const element = input.current;

    if (!element) return;

    const follow = () => setCaret(element.selectionStart);

    element.addEventListener("selectionchange", follow);

    return () => element.removeEventListener("selectionchange", follow);
  }, []);

  const token = tokenAt(text, caret);
  const suggestions = useComposerSuggestions(token, focus);

  const menuOpen =
    token !== null &&
    token.start !== dismissed &&
    suggestions.some((each) => suggests(each.keywords, token.query));

  function complete(suggestion: ComposerSuggestion) {
    if (!token) return;

    const next = replaceToken(text, token, suggestion.value);

    form.setValue("text", next.text);
    setCaret(next.caret);
    requestAnimationFrame(() =>
      input.current?.setSelectionRange(next.caret, next.caret)
    );
  }

  const attachedFocus =
    focus && symbolKey(focus) !== detachedFocus ? focus : null;

  // A message handed back for editing replaces what is being written.
  useEffect(() => {
    if (draft === null) return;

    form.setValue("text", draft);
    form.setFocus("text");
    setDraft(null);
  }, [draft, form, setDraft]);

  const { data: sessions } = useQuery(agentSessionsQuery());
  const { data: settings } = useQuery(agentSettingsQuery());
  const current = sessions?.find((each) => each.id === sessionId);

  const pick: AgentModelPick =
    sessionId === null
      ? unstarted.pick
      : { model: current?.model ?? null, thinking: current?.thinking ?? null };

  const model =
    settings &&
    (pick.model ?? { provider: settings.provider, id: settings.model });

  // The next run's model, whose window the context has to fit.
  const contextWindow =
    settings &&
    model &&
    settings.models.find(
      (each) => each.provider === model.provider && each.id === model.id
    )?.contextWindow;

  const progress = useQuery({
    ...transcriptQuery(sessionId),
    select: progressOf,
  });

  // Until the settings load, the model is taken to run rather than flash the notice.
  const unavailable =
    settings && model && !isModelReady(settings, model)
      ? { settings, model }
      : null;

  const approvalMode =
    sessionId === null
      ? unstarted.approvalMode
      : (current?.approvalMode ?? ApprovalMode.Ask);

  /**
   * The conversation on screen. A new one is created by its first message, on what was picked
   * for it, so picking alone leaves no empty conversation behind.
   */
  async function session() {
    if (sessionId !== null) return sessionId;

    const { pick, approvalMode } = useAgentStore.getState().unstarted;

    const created = await window.solyx.agent.createSession({
      ...pick,
      approvalMode,
    });

    // Seeded before it is shown, so the run's first events fold in without a fetch and the
    // picker keeps showing what was picked.
    queryClient.setQueryData(
      agentQueryKeys.transcript(created.id),
      emptyAgentView()
    );
    queryClient.setQueryData(agentSessionsQuery().queryKey, (old) => [
      created,
      ...(old ?? []),
    ]);
    select(created.id);
    setUnstarted({ approvalMode: ApprovalMode.Ask });

    return created.id;
  }

  const setModel = useMutation({
    mutationFn: ({ id, pick }: { id: string; pick: AgentModelPick }) =>
      window.solyx.agent.setModel(id, pick),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: agentQueryKeys.sessions }),
  });

  const setApprovalMode = useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: ApprovalMode }) =>
      window.solyx.agent.setApprovalMode(id, mode),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: agentQueryKeys.sessions }),
  });

  async function pickModel(next: AgentModelPick) {
    setUnstarted({ pick: next });

    if (sessionId !== null) {
      await setModel.mutateAsync({ id: sessionId, pick: next });
    }
  }

  function pickApprovalMode(mode: ApprovalMode) {
    if (sessionId === null) setUnstarted({ approvalMode: mode });
    else setApprovalMode.mutate({ id: sessionId, mode });
  }

  const compact = useMutation({
    mutationFn: ({
      id,
      instructions,
    }: {
      id: string | null;
      instructions: string | null;
    }) =>
      // A conversation not yet started holds nothing to summarize.
      id === null
        ? Promise.resolve(CompactionOutcome.NothingOld)
        : window.solyx.agent.compact(id, instructions),
  });

  const compacting = progress.data?.compacting === true || compact.isPending;
  const busy = running || compacting;

  const send = useMutation({
    onMutate: () => compact.reset(),
    mutationFn: async (message: string) => {
      const id = await session();
      const locale = currentLocale();

      await window.solyx.agent.send(
        id,
        message,
        attachedFocus && {
          symbol: attachedFocus,
          // The attachment above the input has already asked for it.
          name: listingName(
            queryClient.getQueryData(listingQuery(attachedFocus).queryKey),
            locale
          ),
        },
        locale,
        currentTimeZone()
      );
    },
    onSuccess: () => form.reset(),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: agentQueryKeys.sessions }),
  });

  const abort = useMutation({
    mutationFn: (id: string) => window.solyx.agent.abort(id),
  });

  const submit = form.handleSubmit(({ text }) => {
    const command = messageCommand(text);

    if (command?.command === AgentCommand.Compact) {
      compact.mutate(
        { id: sessionId, instructions: command.rest || null },
        { onSuccess: () => form.reset() }
      );
    } else {
      send.mutate(text);
    }
  });

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
      {compact.error && compact.variables.id === sessionId ? (
        <ErrorAlert
          title={t("agent.compaction.failed")}
          description={compact.error.message}
        />
      ) : null}
      <div className="relative flex flex-col">
        {focus ? (
          <div className="mx-2 rounded-t-sm border border-b-0 border-border bg-surface-secondary">
            <FocusAttachment focus={focus} />
          </div>
        ) : null}
        <div className="rounded-sm border border-border bg-surface shadow-xs transition-colors focus-within:border-field-border-focus">
          <Controller
            control={form.control}
            name="text"
            render={({ field }) => (
              <Autocomplete
                inputValue={field.value}
                onInputChange={field.onChange}
                filter={(keywords) =>
                  token !== null && suggests(keywords, token.query)
                }>
                {menuOpen ? (
                  <ComposerMenu
                    label={t(
                      token.kind === ComposerTokenKind.Skill
                        ? "agent.composer-menu.skills"
                        : "agent.composer-menu.listings"
                    )}
                    suggestions={suggestions}
                    onPick={complete}
                  />
                ) : null}
                <TextField
                  aria-label={t("agent.placeholder")}
                  className="w-full">
                  <TextArea
                    name={field.name}
                    ref={(element) => {
                      field.ref(element);
                      input.current = element;
                    }}
                    rows={1}
                    className="block field-sizing-content max-h-50 min-h-10 w-full resize-none rounded-none border-0 bg-transparent px-3 pt-2 pb-1 text-sm leading-6 shadow-none ring-0"
                    placeholder={t("agent.placeholder")}
                    // The Autocomplete turns spell checking off as for a search field; a message keeps it.
                    spellCheck
                    onBlur={field.onBlur}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return;

                      if (menuOpen) {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setDismissed(token.start);

                          return;
                        }

                        // Enter picks through the Autocomplete; Tab picks the same option.
                        if (event.key === "Tab") {
                          event.preventDefault();

                          // The active descendant trails typing by design, so the focused option is read instead.
                          const list =
                            event.currentTarget.getAttribute("aria-controls");

                          document
                            .getElementById(list ?? "")
                            ?.querySelector<HTMLElement>("[data-focused]")
                            ?.click();

                          return;
                        }

                        if (event.key === "Enter") {
                          event.preventDefault();

                          return;
                        }
                      }

                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();

                        if (!busy && !unavailable) void submit();
                      }
                    }}
                  />
                </TextField>
              </Autocomplete>
            )}
          />
          <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
            <div className="flex min-w-0 items-center gap-1">
              <ApprovalModeMenu
                mode={approvalMode}
                isDisabled={setApprovalMode.isPending}
                onChange={pickApprovalMode}
              />
              {settings ? (
                <AgentModelPicker
                  // What it shows while saving belongs to the conversation it was picked in.
                  key={sessionId}
                  settings={settings}
                  pick={pick}
                  // A run keeps the model it started on, so the next one takes the change.
                  isDisabled={busy}
                  onChange={pickModel}
                />
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {progress.data?.context !== undefined && contextWindow ? (
                <ContextMeter
                  used={progress.data.context}
                  window={contextWindow}
                  compacting={compacting}
                  canCompact={!busy && unavailable === null}
                  onCompact={() =>
                    compact.mutate({ id: sessionId, instructions: null })
                  }
                />
              ) : null}
              {busy && sessionId !== null ? (
                <Button
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  aria-label={t("agent.stop")}
                  isPending={abort.isPending}
                  onPress={() => abort.mutate(sessionId)}>
                  <Icon icon={StopIcon} />
                </Button>
              ) : (
                <Button
                  isIconOnly
                  type="submit"
                  size="sm"
                  variant="secondary"
                  aria-label={t("agent.send")}
                  isPending={send.isPending}
                  isDisabled={!text.trim() || unavailable !== null}>
                  <Icon icon={ArrowUp02Icon} />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
      {unavailable ? <ModelUnavailable {...unavailable} /> : null}
      {compact.data === CompactionOutcome.NothingOld &&
      compact.variables.id === sessionId ? (
        <p className="px-1 text-xs text-muted">
          {t("agent.compaction.nothing-old")}
        </p>
      ) : null}
      {setModel.error ? (
        <ErrorAlert
          title={t("agent.model-picker.failed")}
          description={setModel.error.message}
        />
      ) : null}
      {setApprovalMode.error ? (
        <ErrorAlert
          title={t("agent.approval-mode.failed")}
          description={setApprovalMode.error.message}
        />
      ) : null}
    </Form>
  );
}
