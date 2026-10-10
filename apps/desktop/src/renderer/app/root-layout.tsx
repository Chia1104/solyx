import { useRef } from "react";
import type { ReactNode, RefObject } from "react";

import { cn } from "@heroui/react";
import { Outlet, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { clamp, mapValues } from "es-toolkit";
import { I18nProvider } from "react-aria-components";
import { useTranslation } from "react-i18next";

import { PaneSplitter, SplitterEdge } from "../components/pane-splitter.tsx";
import { BrokerModeRule } from "../modules/account/broker-mode-chip.tsx";

import { AgentPane } from "./agent-pane.tsx";
import { useWorkspaceHotkeys } from "./hotkeys.ts";
import {
  MAIN_MIN_WIDTH,
  PANE_EDGE,
  PANE_LIMITS,
  Pane,
  paneId,
  useLayoutStore,
} from "./layout-store.ts";
import { useHeldPane, useLastPage, useSettingsOpen } from "./settings-open.ts";
import { SettingsPane } from "./settings-pane.tsx";
import { SymbolsPane } from "./symbols-pane.tsx";
import { TitleBar } from "./title-bar.tsx";

// Widths live in custom properties on the workspace, so a drag can preview them without rendering.
const WIDTH_VARIABLE = {
  [Pane.Symbols]: "--pane-symbols",
  [Pane.Agent]: "--pane-agent",
} as const satisfies Record<Pane, string>;

const WIDTH_CLASS: Record<Pane, string> = {
  [Pane.Symbols]: "w-(--pane-symbols)",
  [Pane.Agent]: "w-(--pane-agent)",
};

/** A side pane of the workspace; closed, it keeps its width so its content slides out whole. */
function SidePane({
  pane,
  label,
  shown,
  workspace,
  children,
}: {
  pane: Pane;
  /** Names the pane for what it shows now. */
  label: string;
  /** Which panes show, this one and the other. */
  shown: Record<Pane, boolean>;
  workspace: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const panes = useLayoutStore((state) => state.panes);
  const setWidth = useLayoutStore((state) => state.setWidth);

  const { width } = panes[pane];
  const open = shown[pane];
  const edge = PANE_EDGE[pane];
  const other = pane === Pane.Symbols ? Pane.Agent : Pane.Symbols;

  // The room left once the main view and the other pane keep theirs.
  const maxWidth = () => {
    const total = workspace.current?.clientWidth ?? window.innerWidth;

    const otherWidth = shown[other] ? panes[other].width : 0;

    return clamp(
      total - MAIN_MIN_WIDTH - otherWidth,
      PANE_LIMITS[pane].min,
      PANE_LIMITS[pane].max
    );
  };

  return (
    <aside
      id={paneId(pane)}
      aria-label={label}
      inert={!open}
      className={cn(
        "relative min-w-0",
        open &&
          (edge === SplitterEdge.Start
            ? "border-r border-separator"
            : "border-l border-separator")
      )}>
      <div
        className={cn(
          "absolute inset-y-0 overflow-y-auto",
          WIDTH_CLASS[pane],
          edge === SplitterEdge.Start ? "right-0" : "left-0"
        )}>
        {children}
      </div>
      {open ? (
        <PaneSplitter
          edge={edge}
          label={t("workspace.resize", { pane: label })}
          controls={paneId(pane)}
          size={width}
          min={PANE_LIMITS[pane].min}
          maxSize={maxWidth}
          onPreview={(next) =>
            workspace.current?.style.setProperty(
              WIDTH_VARIABLE[pane],
              `${next}px`
            )
          }
          onCommit={(next) => setWidth(pane, next)}
          onReset={() => setWidth(pane, PANE_LIMITS[pane].default)}
        />
      ) : null}
    </aside>
  );
}

// The symbols pane's two views lie over each other; the one out of use waits to its side, unseen.
const PANE_VIEW =
  "absolute inset-0 transition-[translate,opacity,visibility] duration-200 ease-out-quint motion-reduce:translate-x-0 motion-reduce:transition-[opacity,visibility]";

/**
 * What the symbols pane shows: the listings, or the settings page's sections while it is open.
 * Both stay mounted, so the listings keep their scroll, and one slides aside as the other arrives.
 */
function SymbolsPaneViews() {
  const settings = useSettingsOpen();
  const navigate = useNavigate();
  const lastPage = useLastPage();

  return (
    <div className="relative h-full overflow-clip">
      <div
        inert={settings}
        className={cn(
          PANE_VIEW,
          settings && "invisible -translate-x-6 opacity-0"
        )}>
        <SymbolsPane />
      </div>
      <div
        inert={!settings}
        className={cn(
          PANE_VIEW,
          !settings && "invisible translate-x-6 opacity-0"
        )}>
        <SettingsPane
          onLeave={() => void navigate({ href: lastPage.current })}
        />
      </div>
    </div>
  );
}

/** The panes around the routed main view, under the window's title bar. */
function Workspace() {
  const { t } = useTranslation();
  const workspace = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panes = useLayoutStore((state) => state.panes);
  const settings = useSettingsOpen();
  const held = useHeldPane();

  useWorkspaceHotkeys(searchRef);

  const shown = mapValues(panes, ({ open }, pane) => open || pane === held);

  const column = (pane: Pane) =>
    shown[pane] ? `var(${WIDTH_VARIABLE[pane]})` : "0px";

  // Spread in, since CSSProperties does not list custom properties.
  const widths = {
    [WIDTH_VARIABLE[Pane.Symbols]]: `${panes[Pane.Symbols].width}px`,
    [WIDTH_VARIABLE[Pane.Agent]]: `${panes[Pane.Agent].width}px`,
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden text-sm">
      <TitleBar searchRef={searchRef} />
      <BrokerModeRule />
      <div
        ref={workspace}
        className="grid min-h-0 flex-1 transition-[grid-template-columns] duration-200 ease-out-quint motion-reduce:transition-none [html[data-pane-at-once]_&]:transition-none [html[data-pane-resizing]_&]:transition-none"
        style={{
          ...widths,
          gridTemplateColumns: `${column(Pane.Symbols)} minmax(0, 1fr) ${column(Pane.Agent)}`,
        }}>
        <SidePane
          pane={Pane.Symbols}
          label={t(settings ? "settings.title" : "workspace.symbols")}
          shown={shown}
          workspace={workspace}>
          <SymbolsPaneViews />
        </SidePane>
        <main className="@container/main min-w-0 overflow-y-auto [view-transition-name:main]">
          <Outlet />
        </main>
        <SidePane
          pane={Pane.Agent}
          label={t("workspace.agent")}
          shown={shown}
          workspace={workspace}>
          <AgentPane />
        </SidePane>
      </div>
    </div>
  );
}

export function RootLayout() {
  const { i18n } = useTranslation();
  const matchRoute = useMatchRoute();

  // First-run setup takes the whole window, without the workspace around it.
  const onboarding = matchRoute({ to: "/onboarding" }) !== false;

  return (
    // react-aria formats numbers and announces built-in strings in this locale.
    <I18nProvider locale={i18n.language}>
      {onboarding ? <Outlet /> : <Workspace />}
    </I18nProvider>
  );
}
