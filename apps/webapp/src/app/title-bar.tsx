import type { Ref } from "react";

import { Button, Kbd, Tooltip, cn } from "@heroui/react";
import {
  ArrowLeft01Icon,
  Settings01Icon,
  SidebarLeft01Icon,
  SidebarLeftIcon,
  SidebarRight01Icon,
  SidebarRightIcon,
  StrategyIcon,
} from "@hugeicons/core-free-icons";
import { formatForDisplay } from "@tanstack/react-hotkeys";
import {
  Link,
  useCanGoBack,
  useMatchRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Icon } from "../components/icon.tsx";
import { SplitterEdge } from "../components/pane-splitter.tsx";
import { WindowTitleBar } from "../components/window-title-bar.tsx";
import { BrokerModeChip } from "../modules/account/broker-mode-chip.tsx";
import { MarketSessions } from "../modules/market/market-sessions.tsx";
import { SymbolSearch } from "../modules/market/symbol-search.tsx";
import { OrderLockToggle } from "../modules/proposals/order-lock.tsx";
import { UpdateAction } from "../modules/updates/update-action.tsx";

import { inWindow } from "./device.ts";
import { BACK_HOTKEYS, PANE_HOTKEY, toggleAtOnce } from "./hotkeys.ts";
import { PANE_EDGE, Pane, paneId, useLayoutStore } from "./layout-store.ts";
import { PEEK_DELAY, usePeekStore } from "./pane-peek.ts";
import { useHeldPane, useSettingsOpen } from "./settings-open.ts";

const TOOLTIP_DELAY = 600;

// The window with the pane at each edge, drawn differently while the pane is open.
const PANE_ICON = {
  [SplitterEdge.Start]: { closed: SidebarLeftIcon, open: SidebarLeft01Icon },
  [SplitterEdge.End]: { closed: SidebarRightIcon, open: SidebarRight01Icon },
};

/** Opens or closes a side pane; resting on the toggle of a closed one shows it over the page. */
function PaneToggle({ pane }: { pane: Pane }) {
  const { t } = useTranslation();
  const held = useHeldPane() === pane;
  const open = useLayoutStore((state) => state.panes[pane].open) || held;
  const toggle = useLayoutStore((state) => state.toggle);
  const peeking = usePeekStore((state) => state.pane === pane) && !open;
  const peek = usePeekStore((state) => state.peek);
  const leave = usePeekStore((state) => state.leave);

  const label = t(peeking ? "workspace.pin" : "workspace.toggle", {
    pane: t(`workspace.${pane}`),
  });

  return (
    <Tooltip delay={TOOLTIP_DELAY}>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={label}
        aria-expanded={open}
        aria-controls={paneId(pane)}
        isDisabled={held}
        data-peek={pane}
        onHoverStart={() => {
          if (!open) peek(pane, PEEK_DELAY);
        }}
        onHoverEnd={leave}
        // A pane shown over the page snaps into place rather than sliding in from the edge.
        onPress={() =>
          peeking ? toggleAtOnce(() => toggle(pane)) : toggle(pane)
        }>
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

/** Goes back a page; switching a chart's interval or a settings section is not a page. */
function BackButton() {
  const { t } = useTranslation();
  const { history } = useRouter();
  const canGoBack = useCanGoBack();

  return (
    <Tooltip delay={TOOLTIP_DELAY}>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={t("nav.back")}
        isDisabled={!canGoBack}
        onPress={() => history.back()}>
        <Icon icon={ArrowLeft01Icon} />
      </Button>
      <Tooltip.Content className="flex items-center gap-2">
        {t("nav.back")}
        <Kbd>
          <Kbd.Content>{formatForDisplay(BACK_HOTKEYS[0], {})}</Kbd.Content>
        </Kbd>
      </Tooltip.Content>
    </Tooltip>
  );
}

/** Opens the strategies page, marked while it or a strategy's page is open. */
function StrategiesButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const open = useMatchRoute()({ to: "/strategies", fuzzy: true }) !== false;

  return (
    <Tooltip delay={TOOLTIP_DELAY}>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={t("nav.strategies")}
        className={cn(open && "bg-default")}
        onPress={() => void navigate({ to: "/strategies" })}>
        <Icon icon={StrategyIcon} />
      </Button>
      <Tooltip.Content>{t("nav.strategies")}</Tooltip.Content>
    </Tooltip>
  );
}

function SettingsButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const open = useSettingsOpen();

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

/** The workspace's title bar: the pane toggles, back, search, a waiting update, market sessions, the strategies and settings. */
export function TitleBar({ searchRef }: { searchRef: Ref<HTMLInputElement> }) {
  const { t } = useTranslation();

  return (
    <WindowTitleBar className="px-2">
      <PaneToggle pane={Pane.Symbols} />
      <BackButton />
      <Link to="/" title={t("nav.overview")} className="text-sm font-semibold">
        Solyx
      </Link>
      <SymbolSearch inputRef={searchRef} />
      <div className="ml-auto flex items-center gap-4">
        {inWindow ? <UpdateAction /> : null}
        <MarketSessions />
        <div className="flex items-center gap-2">
          {inWindow ? <OrderLockToggle /> : null}
          <BrokerModeChip />
        </div>
        <div className="flex items-center gap-1">
          <StrategiesButton />
          {inWindow ? <SettingsButton /> : null}
          <PaneToggle pane={Pane.Agent} />
        </div>
      </div>
    </WindowTitleBar>
  );
}
