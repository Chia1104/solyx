import { useRef } from "react";
import type { ReactNode, RefObject } from "react";

import { cn } from "@heroui/react";
import { Outlet } from "@tanstack/react-router";
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
  clampPaneWidth,
  paneId,
  useLayoutStore,
} from "./layout-store.ts";
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
  workspace,
  children,
}: {
  pane: Pane;
  workspace: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const panes = useLayoutStore((state) => state.panes);
  const setWidth = useLayoutStore((state) => state.setWidth);

  const { open } = panes[pane];
  const width = clampPaneWidth(pane, panes[pane].width);
  const edge = PANE_EDGE[pane];
  const other = pane === Pane.Symbols ? Pane.Agent : Pane.Symbols;

  // The room left once the main view and the other pane keep theirs.
  const maxWidth = () => {
    const total = workspace.current?.clientWidth ?? window.innerWidth;

    const otherWidth = panes[other].open
      ? clampPaneWidth(other, panes[other].width)
      : 0;

    return Math.max(
      PANE_LIMITS[pane].min,
      Math.min(PANE_LIMITS[pane].max, total - MAIN_MIN_WIDTH - otherWidth)
    );
  };

  return (
    <aside
      id={paneId(pane)}
      aria-label={t(`workspace.${pane}`)}
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
          label={t("workspace.resize", { pane: t(`workspace.${pane}`) })}
          controls={paneId(pane)}
          width={width}
          min={PANE_LIMITS[pane].min}
          maxWidth={maxWidth}
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

export function RootLayout() {
  const { i18n } = useTranslation();
  const workspace = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panes = useLayoutStore((state) => state.panes);

  useWorkspaceHotkeys(searchRef);

  const column = (pane: Pane) =>
    panes[pane].open ? `var(${WIDTH_VARIABLE[pane]})` : "0px";

  // Spread in, since CSSProperties does not list custom properties.
  const widths = {
    [WIDTH_VARIABLE[Pane.Symbols]]:
      `${clampPaneWidth(Pane.Symbols, panes[Pane.Symbols].width)}px`,
    [WIDTH_VARIABLE[Pane.Agent]]:
      `${clampPaneWidth(Pane.Agent, panes[Pane.Agent].width)}px`,
  };

  return (
    // react-aria formats numbers and announces built-in strings in this locale.
    <I18nProvider locale={i18n.language}>
      <div className="flex h-dvh flex-col overflow-hidden text-sm">
        <TitleBar searchRef={searchRef} />
        <BrokerModeRule />
        <div
          ref={workspace}
          className="grid min-h-0 flex-1 transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none [html[data-pane-resizing]_&]:transition-none"
          style={{
            ...widths,
            gridTemplateColumns: `${column(Pane.Symbols)} minmax(0, 1fr) ${column(Pane.Agent)}`,
          }}>
          <SidePane pane={Pane.Symbols} workspace={workspace}>
            <SymbolsPane />
          </SidePane>
          <main className="@container/main min-w-0 overflow-y-auto">
            <Outlet />
          </main>
          <SidePane pane={Pane.Agent} workspace={workspace}>
            <AgentPane />
          </SidePane>
        </div>
      </div>
    </I18nProvider>
  );
}
