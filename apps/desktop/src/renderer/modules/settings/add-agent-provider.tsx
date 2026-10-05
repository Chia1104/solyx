import { useState } from "react";

import { Button, ListBox, Popover, SearchField } from "@heroui/react";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";

import type { AgentProvider } from "@solyx/agent/providers";

import type { AgentProviderSettings } from "#shared/ipc/settings.ts";

import { Icon } from "../../components/icon.tsx";
import { ProviderMark } from "../agent/agent-provider-mark.tsx";

/** The providers not on the page yet, searched by name, one of which the user picks to add. */
export function AddAgentProvider({
  providers,
  isDisabled,
  onAdd,
}: {
  providers: AgentProviderSettings[];
  isDisabled: boolean;
  onAdd: (provider: AgentProvider) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const label = t("settings.agent.add-provider");
  const searchLabel = t("settings.agent.search-providers");
  const needle = query.trim().toLowerCase();

  const found = providers.filter(
    ({ provider, name }) =>
      needle === "" ||
      name.toLowerCase().includes(needle) ||
      provider.includes(needle)
  );

  return (
    <Popover
      isOpen={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next) setQuery("");
      }}>
      <Button
        size="sm"
        variant="ghost"
        isDisabled={isDisabled || providers.length === 0}
        className="h-7 gap-1 px-2 text-xs">
        <Icon icon={Add01Icon} className="size-3.5" />
        {label}
      </Button>
      <Popover.Content
        placement="bottom end"
        className="w-72 max-w-[calc(100vw-1.5rem)] p-0">
        <Popover.Dialog aria-label={label} className="flex flex-col p-0">
          <div className="border-b border-border px-1 py-1.5">
            <SearchField
              fullWidth
              autoFocus
              aria-label={searchLabel}
              value={query}
              onChange={setQuery}>
              <SearchField.Group className="border-0 bg-transparent shadow-none">
                <SearchField.SearchIcon />
                <SearchField.Input
                  className="text-xs"
                  placeholder={searchLabel}
                />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
          </div>
          <ListBox
            aria-label={label}
            className="max-h-64 overflow-y-auto p-1"
            renderEmptyState={() => (
              <p className="px-2 py-4 text-center text-xs text-muted">
                {t("settings.agent.no-provider-found")}
              </p>
            )}
            onAction={(key) => {
              const picked = providers.find((each) => each.provider === key);

              if (!picked) return;

              setOpen(false);
              onAdd(picked.provider);
            }}>
            {found.map(({ provider, name }) => (
              <ListBox.Item
                key={provider}
                id={provider}
                textValue={name}
                className="gap-2 text-xs">
                <ProviderMark provider={provider} />
                <span className="truncate">{name}</span>
              </ListBox.Item>
            ))}
          </ListBox>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
