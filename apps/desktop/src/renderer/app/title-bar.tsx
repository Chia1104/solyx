import type { Ref } from "react";

import { Button, Kbd, Tooltip, cn } from "@heroui/react";
import { formatForDisplay } from "@tanstack/react-hotkeys";
import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { GearIcon, PaneIcon } from "../components/icons.tsx";
import { BrokerModeChip } from "../modules/account/broker-mode-chip.tsx";
import { MarketSessions } from "../modules/market/market-sessions.tsx";
import { SymbolSearch } from "../modules/market/symbol-search.tsx";

import { PANE_HOTKEY } from "./hotkeys.ts";
import { PANE_EDGE, Pane, paneId, useLayoutStore } from "./layout-store.ts";

function PaneToggle({ pane }: { pane: Pane }) {
  const { t } = useTranslation();
  const open = useLayoutStore((state) => state.panes[pane].open);
  const toggle = useLayoutStore((state) => state.toggle);

  const label = t("workspace.toggle", { pane: t(`workspace.${pane}`) });

  return (
    <Tooltip delay={600}>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={label}
        aria-expanded={open}
        aria-controls={paneId(pane)}
        onPress={() => toggle(pane)}>
        <PaneIcon edge={PANE_EDGE[pane]} open={open} />
      </Button>
      <Tooltip.Content className="flex items-center gap-2">
        {label}
        <Kbd>
          <Kbd.Content>{formatForDisplay(PANE_HOTKEY[pane], {})}</Kbd.Content>
        </Kbd>
      </Tooltip.Content>
    </Tooltip>
  );
}

function SettingsButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();

  const open = matchRoute({ to: "/settings" }) !== false;

  return (
    <Tooltip delay={600}>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={t("nav.settings")}
        className={cn(open && "bg-default")}
        onPress={() => void navigate({ to: "/settings" })}>
        <GearIcon />
      </Button>
      <Tooltip.Content>{t("nav.settings")}</Tooltip.Content>
    </Tooltip>
  );
}

/**
 * The window's own title bar: it moves the window and sits inside the room the OS leaves
 * beside its window controls.
 */
export function TitleBar({ searchRef }: { searchRef: Ref<HTMLInputElement> }) {
  const { t } = useTranslation();

  return (
    <header className="h-11 shrink-0 app-drag">
      <div className="ml-[env(titlebar-area-x,0px)] flex h-full w-[env(titlebar-area-width,100%)] items-center gap-3 px-2">
        <PaneToggle pane={Pane.Symbols} />
        <Link
          to="/"
          title={t("nav.overview")}
          className="text-sm font-semibold">
          Solyx
        </Link>
        <SymbolSearch inputRef={searchRef} />
        <div className="ml-auto flex items-center gap-4">
          <MarketSessions />
          <BrokerModeChip />
          <div className="flex items-center gap-1">
            <SettingsButton />
            <PaneToggle pane={Pane.Agent} />
          </div>
        </div>
      </div>
    </header>
  );
}
