import { Button, Kbd, Tooltip } from "@heroui/react";
import {
  ArrowLeft01Icon,
  SidebarLeft01Icon,
  SidebarLeftIcon,
  SidebarRight01Icon,
  SidebarRightIcon,
} from "@hugeicons/core-free-icons";
import { formatForDisplay } from "@tanstack/react-hotkeys";
import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Icon } from "../components/icon.tsx";
import { SplitterEdge } from "../components/pane-splitter.tsx";

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

/**
 * Goes back a page; switching a chart's interval or a settings section is not a page. Settings
 * opened with no page behind it, as when the window opens on it, leaves to the overview, since
 * this is the way out of settings.
 */
function BackButton() {
  const { t } = useTranslation();
  const { history } = useRouter();
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const settings = useSettingsOpen();

  return (
    <Tooltip delay={TOOLTIP_DELAY}>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={t("nav.back")}
        isDisabled={!canGoBack && !settings}
        onPress={() =>
          canGoBack ? history.back() : void navigate({ to: "/" })
        }>
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

/**
 * What stays at the window's top corners whichever columns show: the symbols pane's toggle and
 * back beside the window's controls at its start, the agent pane's toggle at its end.
 */
export function WindowControls() {
  return (
    <>
      <div className="absolute top-0 left-(--window-start) z-40 flex h-11 items-center gap-1 ps-2 app-drag">
        <PaneToggle pane={Pane.Symbols} />
        <BackButton />
      </div>
      <div className="absolute top-0 right-(--window-end) z-40 flex h-11 items-center pe-2 app-drag">
        <PaneToggle pane={Pane.Agent} />
      </div>
    </>
  );
}
