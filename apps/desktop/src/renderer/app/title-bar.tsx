import type { Ref } from "react";

import { Button, Kbd, Tooltip, cn } from "@heroui/react";
import {
  Settings01Icon,
  SidebarLeft01Icon,
  SidebarLeftIcon,
  SidebarRight01Icon,
  SidebarRightIcon,
} from "@hugeicons/core-free-icons";
import { formatForDisplay } from "@tanstack/react-hotkeys";
import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Icon } from "../components/icon.tsx";
import { SplitterEdge } from "../components/pane-splitter.tsx";
import { WindowTitleBar } from "../components/window-title-bar.tsx";
import { BrokerModeChip } from "../modules/account/broker-mode-chip.tsx";
import { MarketSessions } from "../modules/market/market-sessions.tsx";
import { SymbolSearch } from "../modules/market/symbol-search.tsx";
import { UpdateAction } from "../modules/updates/update-action.tsx";

import { PANE_HOTKEY } from "./hotkeys.ts";
import { PANE_EDGE, Pane, paneId, useLayoutStore } from "./layout-store.ts";

const TOOLTIP_DELAY = 600;

// The window with the pane at each edge, drawn differently while the pane is open.
const PANE_ICON = {
  [SplitterEdge.Start]: { closed: SidebarLeftIcon, open: SidebarLeft01Icon },
  [SplitterEdge.End]: { closed: SidebarRightIcon, open: SidebarRight01Icon },
};

function PaneToggle({ pane }: { pane: Pane }) {
  const { t } = useTranslation();
  const open = useLayoutStore((state) => state.panes[pane].open);
  const toggle = useLayoutStore((state) => state.toggle);

  const label = t("workspace.toggle", { pane: t(`workspace.${pane}`) });

  return (
    <Tooltip delay={TOOLTIP_DELAY}>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={label}
        aria-expanded={open}
        aria-controls={paneId(pane)}
        onPress={() => toggle(pane)}>
        <Icon icon={PANE_ICON[PANE_EDGE[pane]][open ? "open" : "closed"]} />
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
    <Tooltip delay={TOOLTIP_DELAY}>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={t("nav.settings")}
        className={cn(open && "bg-default")}
        onPress={() => void navigate({ to: "/settings" })}>
        <Icon icon={Settings01Icon} />
      </Button>
      <Tooltip.Content>{t("nav.settings")}</Tooltip.Content>
    </Tooltip>
  );
}

/** The workspace's title bar: the pane toggles, search, a waiting update, market sessions and settings. */
export function TitleBar({ searchRef }: { searchRef: Ref<HTMLInputElement> }) {
  const { t } = useTranslation();

  return (
    <WindowTitleBar className="px-2">
      <PaneToggle pane={Pane.Symbols} />
      <Link to="/" title={t("nav.overview")} className="text-sm font-semibold">
        Solyx
      </Link>
      <SymbolSearch inputRef={searchRef} />
      <div className="ml-auto flex items-center gap-4">
        <UpdateAction />
        <MarketSessions />
        <BrokerModeChip />
        <div className="flex items-center gap-1">
          <SettingsButton />
          <PaneToggle pane={Pane.Agent} />
        </div>
      </div>
    </WindowTitleBar>
  );
}
