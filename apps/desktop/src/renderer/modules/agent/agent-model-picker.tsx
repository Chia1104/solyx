import { useState } from "react";

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

import { ProviderMark } from "./agent-provider-mark.tsx";
import { ThinkingSlider } from "./agent-thinking-slider.tsx";

/** A provider's id for a model means nothing under another provider, so the pair is the key. */
const keyOf = (model: AgentModelRef) => `${model.provider} ${model.id}`;

/** The row that stands for the default model; never a provider id, so it cannot collide. */
const DEFAULT_KEY = "";

/**
 * The model a conversation runs on: a rail of the providers switched on, their models to search
 * through, and how long the chosen one thinks. The first row follows the default model in
 * Settings, which is what a conversation runs on until the user picks its own.
 */
export function AgentModelPicker({
  settings,
  pick,
  isDisabled,
  isPending,
  onChange,
}: {
  settings: AgentSettings;
  /** What the conversation picked for itself; `null` parts follow the default. */
  pick: AgentModelPick;
  isDisabled: boolean;
  /** A pick is being saved; the trigger refuses another until it lands. */
  isPending: boolean;
  onChange: (pick: AgentModelPick) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rail, setRail] = useState<AgentProvider | null>(null);
  // The level under the thumb, shown until the save it leads to lands.
  const [dragged, setDragged] = useState<AgentThinking | null>(null);

  const label = t("agent.model-picker.label");

  const defaults: AgentModelRef = {
    provider: settings.provider,
    id: settings.model,
  };

  const chosen = pick.model ?? defaults;

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

  const defaultLabel = t("agent.model-picker.default", {
    model: find(defaults)?.name ?? defaults.id,
  });

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
        isDisabled={isDisabled || isPending}
        isPending={isPending}
        className="h-7 min-w-0 gap-1.5 px-2 text-xs text-muted">
        <ProviderMark provider={chosen.provider} className="size-3.5" />
        <span className="max-w-40 truncate">{current?.name ?? chosen.id}</span>
        {current?.reasoning ? (
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
        placement="top start"
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
                    if (pick.model) onChange({ ...pick, model: null });

                    return;
                  }

                  const next = settings.models.find(
                    (model) => keyOf(model) === key
                  );

                  if (next && (!pick.model || keyOf(pick.model) !== key)) {
                    onChange({
                      ...pick,
                      model: { provider: next.provider, id: next.id },
                    });
                  }
                }}>
                {needle === "" ? (
                  <ListBox.Item
                    id={DEFAULT_KEY}
                    textValue={defaultLabel}
                    className="text-xs">
                    <span className="truncate text-muted">{defaultLabel}</span>
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
          {current?.reasoning ? (
            <div className="border-t border-border px-3 py-2">
              <ThinkingSlider
                value={thinking}
                isDisabled={isPending}
                onChange={setDragged}
                onCommit={(level) => {
                  setDragged(null);

                  if (level !== (pick.thinking ?? settings.thinking)) {
                    onChange({ ...pick, thinking: level });
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
