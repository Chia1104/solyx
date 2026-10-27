import { useEffect, useRef, useState } from "react";
import type { ComponentProps, KeyboardEvent, RefObject } from "react";

import { Button, Form, TextArea, TextField } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowUp02Icon, StopIcon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Autocomplete,
  DIRECTORY_DRAG_TYPE,
  DropZone,
} from "react-aria-components";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { AttachmentImageType } from "@solyx/agent/attachment";
import type { AgentModelPick, AgentModelRef } from "@solyx/agent/providers";
import {
  AgentCommand,
  ApprovalMode,
  CompactionOutcome,
  emptyAgentView,
  messageCommand,
} from "@solyx/agent/wire";
import type { AgentView } from "@solyx/agent/wire";
import { ScreenKind } from "@solyx/api/agent";
import type { AgentScreen } from "@solyx/api/agent";
import type { AgentSettings } from "@solyx/api/settings";
import { SettingsSection } from "@solyx/api/settings-section";
import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { currentTimeZone } from "../../app/clock.ts";
import { inWindow } from "../../app/device.ts";
import { currentLocale } from "../../app/i18n.ts";
import { client, orpc } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { Icon } from "../../components/icon.tsx";
import { listingName } from "../market/listing-name.tsx";
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
import { AttachButton, MessageAttachments } from "./composer-attachments.tsx";
import { useComposerFiles } from "./composer-files.ts";
import type { RefusedFile } from "./composer-files.ts";
import {
  ComposerMenu,
  suggests,
  useComposerSuggestions,
} from "./composer-menu.tsx";
import type { ComposerSuggestion } from "./composer-menu.tsx";
import { ComposerTokenKind, replaceToken, tokenAt } from "./composer-token.ts";

// What the file picker offers; whatever is picked or dropped is read by its bytes all the same.
const ACCEPTED_FILES = [
  ...Object.values(AttachmentImageType),
  "text/*",
  ".csv",
  ".tsv",
  ".md",
  ".json",
];

// An empty message only disables sending, so it needs no message of its own.
const composerSchema = z.object({ text: z.string().trim().min(1) });

// Streaming replaces the transcript every frame, while the composer needs only this.
const progressOf = (view: AgentView) => ({
  context: view.context,
  /** A summary the user asked for is being written. */
  compacting: view.compactions.some((each) => each.manual),
});

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
        search={{ section: SettingsSection.Models }}
        className="underline underline-offset-2">
        {t("agent.open-settings")}
      </Link>
    </p>
  );
}

/**
 * What the window shows, as a message sends it: a listing's page named in the app's language, or
 * nothing of it once the user detached the listing.
 */
function sentScreen(
  screen: AgentScreen | null,
  attached: SymbolRef | null,
  nameOf: (symbol: SymbolRef) => string | undefined
): AgentScreen | null {
  if (screen?.kind !== ScreenKind.Listing) return screen;

  return attached && { ...screen, name: nameOf(attached) };
}

/**
 * What the composer has to say under the input: a model that cannot run or see the images
 * attached, files it would not take, a summary with nothing to fold, a change that failed.
 */
function ComposerNotes({
  unavailable,
  unreadable,
  refused,
  nothingOld,
  errors,
}: {
  unavailable: ComponentProps<typeof ModelUnavailable> | null;
  /** The model that sees no images the message carries, by its name. */
  unreadable: string | null;
  refused: readonly RefusedFile[];
  nothingOld: boolean;
  errors: readonly { title: string; error: Error | null }[];
}) {
  const { t } = useTranslation();

  return (
    <>
      {unavailable ? <ModelUnavailable {...unavailable} /> : null}
      {unreadable ? (
        <p className="px-1 text-xs text-warning">
          {t("agent.attachments.no-images", { model: unreadable })}
        </p>
      ) : null}
      {refused.map(({ name, reason }) => (
        <p key={name} className="px-1 text-xs text-warning">
          {t(`agent.attachments.refused.${reason}`, { name })}
        </p>
      ))}
      {nothingOld ? (
        <p className="px-1 text-xs text-muted">
          {t("agent.compaction.nothing-old")}
        </p>
      ) : null}
      {errors.map(({ title, error }) =>
        error ? (
          <ErrorAlert key={title} title={title} description={error.message} />
        ) : null
      )}
    </>
  );
}

/** Where the caret stands in `input`, which a completion moves too. */
function useCaret(input: RefObject<HTMLTextAreaElement | null>) {
  const [caret, setCaret] = useState(0);

  // Chromium fires `selectionchange` at a textarea without bubbling, so React's `onSelect` misses it.
  useEffect(() => {
    const element = input.current;

    if (!element) return;

    const follow = () => setCaret(element.selectionStart);

    element.addEventListener("selectionchange", follow);

    return () => element.removeEventListener("selectionchange", follow);
  }, [input]);

  return [caret, setCaret] as const;
}

/**
 * Takes a key pressed while the suggestions are open: Escape closes them through `dismiss`, Tab
 * picks the option in focus and Enter is left to the Autocomplete. Says whether the key was theirs.
 */
function menuKey(
  event: KeyboardEvent<HTMLTextAreaElement>,
  dismiss: () => void
): boolean {
  if (event.key === "Escape") {
    event.preventDefault();
    dismiss();

    return true;
  }

  // Enter picks through the Autocomplete; Tab picks the same option.
  if (event.key === "Tab") {
    event.preventDefault();

    // The active descendant trails typing by design, so the focused option is read instead.
    const list = event.currentTarget.getAttribute("aria-controls");

    document
      .getElementById(list ?? "")
      ?.querySelector<HTMLElement>("[data-focused]")
      ?.click();

    return true;
  }

  if (event.key === "Enter") {
    event.preventDefault();

    return true;
  }

  return false;
}

/**
 * What the conversation on screen runs on and how it asks, or what a new one would, and the way to
 * change either. A new conversation is created by its first message (`session`), on what was
 * picked for it, so picking alone leaves no empty conversation behind.
 */
function useConversationSetup(sessionId: string | null) {
  const queryClient = useQueryClient();
  const select = useAgentStore((state) => state.select);
  const unstarted = useAgentStore((state) => state.unstarted);
  const setUnstarted = useAgentStore((state) => state.setUnstarted);
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

  const setModel = useMutation(
    orpc.agent.setModel.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries({ queryKey: orpc.agent.sessions.key() }),
    })
  );

  const setApprovalMode = useMutation(
    orpc.agent.setApprovalMode.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries({ queryKey: orpc.agent.sessions.key() }),
    })
  );

  async function session() {
    if (sessionId !== null) return sessionId;

    const { pick, approvalMode } = useAgentStore.getState().unstarted;

    const created = await client.agent.createSession({
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

  // The next run's model, whose window the context has to fit and which may see no images.
  const option =
    settings &&
    model &&
    settings.models.find(
      (each) => each.provider === model.provider && each.id === model.id
    );

  return {
    settings,
    pick,
    contextWindow: option?.contextWindow,
    /** The next run's model by its name where it sees no images; until the settings load, it is taken to. */
    blind: option && !option.images ? option.name : null,
    // Until the settings load, the model is taken to run rather than flash the notice.
    unavailable:
      settings && model && !isModelReady(settings, model)
        ? { settings, model }
        : null,
    approvalMode:
      sessionId === null
        ? unstarted.approvalMode
        : (current?.approvalMode ?? ApprovalMode.Ask),
    session,
    setModel,
    setApprovalMode,
    pickModel,
    pickApprovalMode,
  };
}

/**
 * Writes to the conversation on screen, starting one when there is none, on a model that can run. Enter sends and
 * Shift+Enter breaks the line; Enter that confirms an input method's composition does neither. `@` suggests a
 * listing and a leading `/` a skill: while the list is open, Enter and Tab pick and Escape closes it.
 */
export function AgentComposer({
  sessionId,
  running,
  screen,
}: {
  sessionId: string | null;
  running: boolean;
  /** What the window shows. */
  screen: AgentScreen | null;
}) {
  // The listing on screen, which the user may detach from the message.
  const focus = screen?.kind === ScreenKind.Listing ? screen.symbol : null;

  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const detachedFocus = useAgentStore((state) => state.detachedFocus);
  const draft = useAgentStore((state) => state.draft);
  const setDraft = useAgentStore((state) => state.setDraft);

  const {
    settings,
    pick,
    contextWindow,
    blind,
    unavailable,
    approvalMode,
    session,
    setModel,
    setApprovalMode,
    pickModel,
    pickApprovalMode,
  } = useConversationSetup(sessionId);

  const form = useForm({
    resolver: zodResolver(composerSchema),
    defaultValues: { text: "" },
  });

  const text = useWatch({ control: form.control, name: "text" });

  const input = useRef<HTMLTextAreaElement | null>(null);
  const [caret, setCaret] = useCaret(input);

  const files = useComposerFiles({
    insertText: (words) =>
      form.setValue("text", text.slice(0, caret) + words + text.slice(caret)),
  });

  const unreadable = files.holdsImages && blind !== null;

  // What keeps a message from going besides a run under way: a model that cannot run or see its
  // images, or files still being read.
  const held = unavailable !== null || unreadable || files.reading;

  // The token Escape closed the menu on, which stays closed until the caret leaves it.
  const [dismissed, setDismissed] = useState<number | null>(null);

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

  const progress = useQuery({
    ...transcriptQuery(sessionId),
    select: progressOf,
  });

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
        : client.agent.compact({ id, instructions }),
  });

  const compacting = progress.data?.compacting === true || compact.isPending;
  const busy = running || compacting;

  const send = useMutation({
    onMutate: () => compact.reset(),
    mutationFn: async ({
      message,
      attachments,
    }: {
      message: string;
      attachments: File[];
    }) => {
      const id = await session();
      const locale = currentLocale();

      await client.agent.send({
        id,
        text: message,
        attachments,
        screen: sentScreen(screen, attachedFocus, (symbol) =>
          // The attachment above the input has already asked for it.
          listingName(
            queryClient.getQueryData(listingQuery(symbol).queryKey),
            locale
          )
        ),
        locale,
        timeZone: currentTimeZone(),
      });
    },
    onSuccess: () => {
      form.reset();
      files.clear();
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: orpc.agent.sessions.key() }),
  });

  const abort = useMutation(orpc.agent.abort.mutationOptions());

  const submit = form.handleSubmit(({ text }) => {
    const command = messageCommand(text);

    if (command?.command === AgentCommand.Compact) {
      compact.mutate(
        { id: sessionId, instructions: command.rest || null },
        { onSuccess: () => form.reset() }
      );
    } else {
      send.mutate({
        message: text,
        attachments: files.files.map((pending) => pending.file),
      });
    }
  });

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;

    if (menuOpen && menuKey(event, () => setDismissed(token.start))) return;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();

      if (!busy && !held) void submit();
    }
  }

  return (
    <Form
      validationBehavior="aria"
      className="flex shrink-0 flex-col gap-2 pt-2"
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
      {/* It holds its attachments a gap inside its edge, so it rounds wider by the gap, as the board does. */}
      <DropZone
        aria-label={t("agent.attachments.drop")}
        getDropOperation={(types) =>
          types.has(DIRECTORY_DRAG_TYPE) ? "cancel" : "copy"
        }
        onDrop={(event) => void files.drop(event.items)}
        className="relative rounded-board border border-border bg-surface shadow-xs transition-colors focus-within:border-field-border-focus data-drop-target:border-accent">
        <MessageAttachments
          focus={focus}
          files={files.files}
          blind={blind !== null}
          onRemove={files.remove}
        />
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
              <TextField aria-label={t("agent.placeholder")} className="w-full">
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
                  onKeyDown={onKeyDown}
                  // A screenshot pasted rides with the message rather than as its name.
                  onPaste={(event) => {
                    if (files.paste(event.clipboardData)) {
                      event.preventDefault();
                    }
                  }}
                />
              </TextField>
            </Autocomplete>
          )}
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <div className="flex min-w-0 items-center gap-1">
            <AttachButton
              accepts={ACCEPTED_FILES}
              onPick={(picked) => void files.add(picked)}
            />
            {/* A browser's messages ask before every call, whatever the mode the computer set. */}
            {inWindow ? (
              <ApprovalModeMenu
                mode={approvalMode}
                isDisabled={setApprovalMode.isPending}
                onChange={pickApprovalMode}
              />
            ) : null}
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
                isDisabled={!text.trim() || held}>
                <Icon icon={ArrowUp02Icon} />
              </Button>
            )}
          </div>
        </div>
      </DropZone>
      <ComposerNotes
        unavailable={unavailable}
        unreadable={unreadable ? blind : null}
        refused={files.refused}
        nothingOld={
          compact.data === CompactionOutcome.NothingOld &&
          compact.variables.id === sessionId
        }
        errors={[
          { title: t("agent.model-picker.failed"), error: setModel.error },
          {
            title: t("agent.approval-mode.failed"),
            error: setApprovalMode.error,
          },
        ]}
      />
    </Form>
  );
}
