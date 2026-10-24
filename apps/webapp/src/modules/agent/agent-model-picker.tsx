import { useState } from "react";
import type { ComponentProps } from "react";

import {
  Button,
  ListBox,
  ListLayout,
  Popover,
  ScrollShadow,
  SearchField,
  Tooltip,
  Virtualizer,
  cn,
} from "@heroui/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { groupBy } from "es-toolkit";
import type { Key } from "react-aria-components";
import { useTranslation } from "react-i18next";

import type {
  AgentModelPick,
  AgentModelRef,
  AgentProvider,
  AgentThinking,
} from "@solyx/agent/providers";
import type { AgentModelOption, AgentSettings } from "@solyx/api/settings";
import { matchesFilter } from "@solyx/utils/search";

import { Icon } from "../../components/icon.tsx";
import { isModelReady } from "../settings/settings-query.ts";

import { ProviderMark } from "./agent-provider-mark.tsx";
import { ThinkingSlider } from "./agent-thinking-slider.tsx";

/** A provider's id for a model means nothing under another provider, so the pair is the key. */
const keyOf = (model: AgentModelRef) => `${model.provider} ${model.id}`;

/** The row that stands for the default model; never a provider id, so it cannot collide. */
const DEFAULT_KEY = "";

/** The rail of providers switched on, each by its mark, `active` the one whose models are listed. */
function ProviderRail({
  providers,
  active,
  nameOf,
  onSelect,
}: {
  providers: readonly AgentProvider[];
  active: AgentProvider | undefined;
  nameOf: (provider: AgentProvider) => string;
  onSelect: (provider: AgentProvider) => void;
}) {
  return (
    // Each mark keeps its size and the rail scrolls, however many providers are on.
    <ScrollShadow
      hideScrollBar
      size={24}
      className="flex max-h-68 w-12 shrink-0 flex-col items-center gap-1 border-r border-border py-2">
      {providers.map((provider) => (
        <Tooltip key={provider} delay={300}>
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label={nameOf(provider)}
            aria-pressed={provider === active}
            className={cn(
              "size-9 shrink-0",
              provider === active
                ? "bg-surface-secondary text-foreground"
                : "text-muted"
            )}
            onPress={() => onSelect(provider)}>
            <ProviderMark provider={provider} className="size-4.5" />
          </Button>
          <Tooltip.Content placement="right">
            {nameOf(provider)}
          </Tooltip.Content>
        </Tooltip>
      ))}
    </ScrollShadow>
  );
}

/** A model's row: its name, and its provider's, marked where the provider is not set up. */
function ModelRow({
  model,
  providerName,
  usable,
}: {
  model: AgentModelOption;
  providerName: string;
  usable: boolean;
}) {
  const { t } = useTranslation();

  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="truncate">{model.name}</span>
      <span className="flex items-center gap-1 text-[10px] text-muted">
        <ProviderMark provider={model.provider} className="size-3" />
        {providerName}
        {usable ? null : ` · ${t("agent.model-picker.needs-setup")}`}
      </span>
    </span>
  );
}

/**
 * What the picker offers for `pick`: the model it runs on and whether that can run, the providers
 * switched on in the order Settings lists them, and the models of the one on the rail that match
 * `query`.
 */
function pickerOptions(
  settings: AgentSettings,
  pick: AgentModelPick,
  fallback: string | undefined,
  rail: AgentProvider | null,
  query: string
) {
  const defaults: AgentModelRef = {
    provider: settings.provider,
    id: settings.model,
  };

  const chosen = pick.model ?? defaults;

  const find = (ref: AgentModelRef) =>
    settings.models.find((model) => keyOf(model) === keyOf(ref));

  const byProvider = groupBy(settings.models, (model) => model.provider);

  const names = new Map(
    settings.providers.map((provider) => [provider.provider, provider.name])
  );

  // What a `null` model follows, where that is not the default model.
  const follows = pick.model === null ? fallback : undefined;

  const providers = settings.providers
    .map((provider) => provider.provider)
    .filter((provider) => byProvider[provider] !== undefined);

  const active =
    providers.find((provider) => provider === (rail ?? chosen.provider)) ??
    providers[0];

  return {
    defaults,
    chosen,
    follows,
    current: find(chosen),
    defaultModel: find(defaults),
    usable: new Set(
      settings.providers
        .filter((provider) => provider.usable)
        .map((provider) => provider.provider)
    ),
    nameOf: (provider: AgentProvider) => names.get(provider) ?? provider,
    // Following another picker's model, such as the conversation's, runs whatever that one does.
    defaultRuns: fallback !== undefined || isModelReady(settings, defaults),
    runs: follows !== undefined || isModelReady(settings, chosen),
    providers,
    active,
    visible: (active ? (byProvider[active] ?? []) : []).filter((model) =>
      matchesFilter(query, model.name, model.id)
    ),
  };
}

/** The pick the row `key` makes of `pick`; `null` where that row is the model in force already. */
function pickOf(
  pick: AgentModelPick,
  key: Key | undefined,
  models: readonly AgentModelOption[]
): AgentModelPick | null {
  if (key === DEFAULT_KEY) return pick.model ? { ...pick, model: null } : null;

  const next = models.find((model) => keyOf(model) === key);

  return next && (!pick.model || keyOf(pick.model) !== key)
    ? { ...pick, model: { provider: next.provider, id: next.id } }
    : null;
}

/** The trigger's face: the model the pick runs on, warned of where it cannot run, and how long it thinks. */
function TriggerLabel({
  follows,
  chosen,
  name,
  runs,
  thinking,
  open,
}: {
  /** What a `null` model follows, shown in its place. */
  follows: string | undefined;
  chosen: AgentModelRef;
  name: string;
  runs: boolean;
  /** How long the model thinks; `null` where it does not reason or has no say in it. */
  thinking: AgentThinking | null;
  open: boolean;
}) {
  const { t } = useTranslation();

  return (
    <>
      {follows === undefined ? (
        <>
          <ProviderMark provider={chosen.provider} className="size-3.5" />
          <span
            className="max-w-40 truncate"
            title={runs ? undefined : t("agent.model-picker.needs-setup")}>
            {name}
          </span>
        </>
      ) : (
        <span className="max-w-40 truncate">{follows}</span>
      )}
      {thinking === null ? null : (
        <>
          <span aria-hidden className="mx-0.5 h-3 w-px bg-separator" />
          <span>{t(`settings.agent.thinkings.${thinking}`)}</span>
        </>
      )}
      <Icon
        icon={ArrowDown01Icon}
        className={cn(
          "size-3.5 transition-transform ease-out-quint motion-reduce:transition-none",
          open && "rotate-180"
        )}
      />
    </>
  );
}

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

  const {
    defaults,
    chosen,
    follows,
    current,
    defaultModel,
    usable,
    nameOf,
    defaultRuns,
    runs,
    providers,
    active,
    visible,
  } = pickerOptions(settings, pick, fallback, rail, query);

  const thinking = dragged ?? pick.thinking ?? settings.thinking;

  const defaultLabel =
    fallback ??
    t("agent.model-picker.default", {
      model: defaultModel?.name ?? defaults.id,
    });

  const reasoning =
    thinks && follows === undefined && current?.reasoning === true;

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
        <TriggerLabel
          follows={follows}
          chosen={chosen}
          name={current?.name ?? chosen.id}
          runs={runs}
          thinking={reasoning ? thinking : null}
          open={open}
        />
      </Button>
      <Popover.Content
        placement={placement}
        className="w-80 max-w-[calc(100vw-1.5rem)] p-0">
        <Popover.Dialog aria-label={label} className="flex flex-col p-0">
          <div className="flex min-h-0">
            <ProviderRail
              providers={providers}
              active={active}
              nameOf={nameOf}
              onSelect={setRail}
            />
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
              {/* A provider such as OpenRouter offers hundreds of models: only the rows in view are rendered. */}
              <Virtualizer
                layout={ListLayout}
                layoutOptions={{ estimatedRowSize: 40, padding: 4 }}>
                <ListBox
                  // Focuses the model in force as the picker opens, which scrolls it into view.
                  autoFocus
                  aria-label={label}
                  selectionMode="single"
                  disallowEmptySelection
                  className="max-h-56 overflow-y-auto"
                  selectedKeys={[pick.model ? keyOf(pick.model) : DEFAULT_KEY]}
                  renderEmptyState={() => (
                    <p className="px-2 py-4 text-center text-xs text-muted">
                      {t("agent.model-picker.empty")}
                    </p>
                  )}
                  onSelectionChange={(keys) => {
                    if (keys === "all") return;

                    const [key] = keys;
                    const next = pickOf(pick, key, settings.models);

                    if (next) change(next);
                  }}>
                  {query.trim() === "" ? (
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
                      <ModelRow
                        model={model}
                        providerName={nameOf(model.provider)}
                        usable={usable.has(model.provider)}
                      />
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Virtualizer>
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
