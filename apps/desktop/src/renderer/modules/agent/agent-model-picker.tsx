import { useState } from "react";
import type { ComponentProps } from "react";

import {
  Button,
  ListBox,
  Popover,
  SearchField,
  Tooltip,
  cn,
} from "@heroui/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { groupBy } from "es-toolkit";
import { useTranslation } from "react-i18next";

import type {
  AgentModelPick,
  AgentModelRef,
  AgentProvider,
  AgentThinking,
} from "@solyx/agent/providers";

import type { AgentSettings } from "#shared/ipc/settings.ts";

import { Icon } from "../../components/icon.tsx";
import { isModelReady } from "../settings/settings-query.ts";

import { ProviderMark } from "./agent-provider-mark.tsx";
import { ThinkingSlider } from "./agent-thinking-slider.tsx";

/** A provider's id for a model means nothing under another provider, so the pair is the key. */
const keyOf = (model: AgentModelRef) => `${model.provider} ${model.id}`;

/** The row that stands for the default model; never a provider id, so it cannot collide. */
const DEFAULT_KEY = "";

/**
 * A model to run on: a rail of the providers switched on, their models to search through, and how
 * long the chosen one thinks. The first row follows the default model in Settings, which is what
 * a conversation runs on until the user picks its own. A model whose provider has no key or
 * sign-in cannot be picked, and one already picked is marked on the trigger.
 */
export function AgentModelPicker({
  settings,
  pick: saved,
  fallback,
  thinks = true,
  placement = "top start",
  "aria-label": ariaLabel,
  isDisabled,
  onChange,
}: {
  settings: AgentSettings;
  /** What was picked; `null` parts follow the default. */
  pick: AgentModelPick;
  /** Names what a `null` model follows when that is not the default model, such as a MAGI unit's. */
  fallback?: string;
  /** Offers how long the model thinks; a model that only answers questions has no say in it. */
  thinks?: boolean;
  placement?: ComponentProps<typeof Popover.Content>["placement"];
  "aria-label"?: string;
  isDisabled?: boolean;
  /** Settles once the pick is saved and `pick` shows it; until then the picker shows it itself. */
  onChange: (pick: AgentModelPick) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rail, setRail] = useState<AgentProvider | null>(null);
  // The level under the thumb, shown until it is let go.
  const [dragged, setDragged] = useState<AgentThinking | null>(null);
  // The latest pick, shown until its save settles.
  const [saving, setSaving] = useState<AgentModelPick | null>(null);

  const pick = saving ?? saved;
  const label = ariaLabel ?? t("agent.model-picker.label");

  function change(next: AgentModelPick) {
    setSaving(next);

    const settle = () =>
      setSaving((latest) => (latest === next ? null : latest));

    // A failed save reports itself through its caller and falls back to `pick`.
    void Promise.resolve(onChange(next)).then(settle, settle);
  }

  const defaults: AgentModelRef = {
    provider: settings.provider,
    id: settings.model,
  };

  const chosen = pick.model ?? defaults;
  const follows = pick.model === null && fallback !== undefined;

  const find = (ref: AgentModelRef) =>
    settings.models.find((model) => keyOf(model) === keyOf(ref));

  const current = find(chosen);
  const thinking = dragged ?? pick.thinking ?? settings.thinking;
  const byProvider = groupBy(settings.models, (model) => model.provider);

  const usable = new Set(
    settings.providers
      .filter((provider) => provider.usable)
      .map((provider) => provider.provider)
  );

  const names = new Map(
    settings.providers.map((provider) => [provider.provider, provider.name])
  );

  const nameOf = (provider: AgentProvider) => names.get(provider) ?? provider;

  // Following another picker's model, such as the conversation's, runs whatever that one does.
  const defaultRuns =
    fallback !== undefined || isModelReady(settings, defaults);

  const runs = follows || isModelReady(settings, chosen);

  // In the order Settings lists them.
  const providers = settings.providers
    .map((provider) => provider.provider)
    .filter((provider) => byProvider[provider] !== undefined);

  const active =
    providers.find((provider) => provider === (rail ?? chosen.provider)) ??
    providers[0];

  const needle = query.trim().toLowerCase();

  const visible = (active ? (byProvider[active] ?? []) : []).filter(
    (model) =>
      needle === "" ||
      model.name.toLowerCase().includes(needle) ||
      model.id.toLowerCase().includes(needle)
  );

  const defaultLabel =
    fallback ??
    t("agent.model-picker.default", {
      model: find(defaults)?.name ?? defaults.id,
    });

  const reasoning = thinks && !follows && current?.reasoning === true;

  return (
    <Popover
      isOpen={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next) {
          setQuery("");
          setRail(null);
        }
      }}>
      <Button
        size="sm"
        variant="ghost"
        aria-label={label}
        isDisabled={isDisabled}
        className={cn(
          "h-7 min-w-0 gap-1.5 px-2 text-xs text-muted",
          !runs && "text-warning"
        )}>
        {follows ? (
          <span className="max-w-40 truncate">{fallback}</span>
        ) : (
          <>
            <ProviderMark provider={chosen.provider} className="size-3.5" />
            <span
              className="max-w-40 truncate"
              title={runs ? undefined : t("agent.model-picker.needs-setup")}>
              {current?.name ?? chosen.id}
            </span>
          </>
        )}
        {reasoning ? (
          <>
            <span aria-hidden className="mx-0.5 h-3 w-px bg-separator" />
            <span>{t(`settings.agent.thinkings.${thinking}`)}</span>
          </>
        ) : null}
        <Icon
          icon={ArrowDown01Icon}
          className={cn(
            "size-3.5 transition-transform ease-out-quint motion-reduce:transition-none",
            open && "rotate-180"
          )}
        />
      </Button>
      <Popover.Content
        placement={placement}
        className="w-80 max-w-[calc(100vw-1.5rem)] p-0">
        <Popover.Dialog aria-label={label} className="flex flex-col p-0">
          <div className="flex min-h-0">
            <div className="flex max-h-68 w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border py-2">
              {providers.map((provider) => (
                <Tooltip key={provider} delay={300}>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    aria-label={nameOf(provider)}
                    aria-pressed={provider === active}
                    className={cn(
                      "size-9",
                      provider === active
                        ? "bg-surface-secondary text-foreground"
                        : "text-muted"
                    )}
                    onPress={() => setRail(provider)}>
                    <ProviderMark provider={provider} className="size-4.5" />
                  </Button>
                  <Tooltip.Content placement="right">
                    {nameOf(provider)}
                  </Tooltip.Content>
                </Tooltip>
              ))}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="px-1 py-1.5">
                <SearchField
                  fullWidth
                  aria-label={t("agent.model-picker.search")}
                  value={query}
                  onChange={setQuery}>
                  <SearchField.Group className="border-0 bg-transparent shadow-none">
                    <SearchField.SearchIcon />
                    <SearchField.Input
                      className="text-xs"
                      placeholder={t("agent.model-picker.search")}
                    />
                    <SearchField.ClearButton />
                  </SearchField.Group>
                </SearchField>
              </div>
              <ListBox
                // Focuses the model in force as the picker opens, which scrolls it into view.
                autoFocus
                aria-label={label}
                selectionMode="single"
                disallowEmptySelection
                className="max-h-56 overflow-y-auto px-1 pb-1"
                selectedKeys={[pick.model ? keyOf(pick.model) : DEFAULT_KEY]}
                renderEmptyState={() => (
                  <p className="px-2 py-4 text-center text-xs text-muted">
                    {t("agent.model-picker.empty")}
                  </p>
                )}
                onSelectionChange={(keys) => {
                  if (keys === "all") return;

                  const [key] = keys;

                  if (key === DEFAULT_KEY) {
                    if (pick.model) change({ ...pick, model: null });

                    return;
                  }

                  const next = settings.models.find(
                    (model) => keyOf(model) === key
                  );

                  if (next && (!pick.model || keyOf(pick.model) !== key)) {
                    change({
                      ...pick,
                      model: { provider: next.provider, id: next.id },
                    });
                  }
                }}>
                {needle === "" ? (
                  <ListBox.Item
                    id={DEFAULT_KEY}
                    textValue={defaultLabel}
                    isDisabled={!defaultRuns}
                    className="text-xs">
                    <span className="truncate text-muted">
                      {defaultRuns
                        ? defaultLabel
                        : `${defaultLabel} · ${t("agent.model-picker.needs-setup")}`}
                    </span>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ) : null}
                {visible.map((model) => (
                  <ListBox.Item
                    key={keyOf(model)}
                    id={keyOf(model)}
                    textValue={model.name}
                    isDisabled={!usable.has(model.provider)}
                    className="text-xs">
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate">{model.name}</span>
                      <span className="flex items-center gap-1 text-[10px] text-muted">
                        <ProviderMark
                          provider={model.provider}
                          className="size-3"
                        />
                        {nameOf(model.provider)}
                        {usable.has(model.provider)
                          ? null
                          : ` · ${t("agent.model-picker.needs-setup")}`}
                      </span>
                    </span>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </div>
          </div>
          {reasoning ? (
            <div className="border-t border-border px-3 py-2">
              <ThinkingSlider
                value={thinking}
                onChange={setDragged}
                onCommit={(level) => {
                  setDragged(null);

                  if (level !== (pick.thinking ?? settings.thinking)) {
                    change({ ...pick, thinking: level });
                  }
                }}
              />
            </div>
          ) : null}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
