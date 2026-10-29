import { useRef } from "react";
import type { ReactNode, RefObject } from "react";

import { cn } from "@heroui/react";
import { Outlet, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { clamp, mapValues } from "es-toolkit";
import { I18nProvider } from "react-aria-components";
import { useTranslation } from "react-i18next";

import { ColumnHeader } from "../components/column-header.tsx";
import { PaneSplitter, SplitterEdge } from "../components/pane-splitter.tsx";
import { BrokerModeScope } from "../modules/account/broker-mode-chip.tsx";
import { useListingSearchStore } from "../modules/market/listing-search-store.ts";
import { ListingSearchDialog } from "../modules/market/listing-search.tsx";

import { AgentPane } from "./agent-pane.tsx";
import { inWindow } from "./device.ts";
import { useWorkspaceHotkeys } from "./hotkeys.ts";
import {
  MAIN_MIN_WIDTH,
  PANE_EDGE,
  PANE_LIMITS,
  Pane,
  paneId,
  useLayoutStore,
} from "./layout-store.ts";
import {
  PEEK_DELAY,
  peekSurface,
  useFollowPeek,
  usePeekStore,
} from "./pane-peek.ts";
import { useHeldPane, useLastPage, useSettingsOpen } from "./settings-open.ts";
import { SettingsPane } from "./settings-pane.tsx";
import { SymbolsPaneFoot } from "./symbols-pane-foot.tsx";
import { SymbolsPane } from "./symbols-pane.tsx";
import { WindowControls } from "./window-controls.tsx";

// Widths live in custom properties on the workspace, so a drag can preview them without rendering.
const WIDTH_VARIABLE = {
  [Pane.Symbols]: "--pane-symbols",
  [Pane.Agent]: "--pane-agent",
} as const satisfies Record<Pane, string>;

const WIDTH_CLASS: Record<Pane, string> = {
  [Pane.Symbols]: "w-(--pane-symbols)",
  [Pane.Agent]: "w-(--pane-agent)",
};

/** Where a pane at each edge of the window draws what faces the main view. */
const EDGE_CLASS: Record<
  SplitterEdge,
  { docked: string; content: string; peeking: string; splitter: string }
> = {
  [SplitterEdge.Start]: {
    // Docked, it is the column at its end of the window, so its header keeps clear of what lies there.
    docked: "border-r border-separator [--column-start:var(--chrome-start)]",
    content: "right-0",
    // Out of the window while closed, it moves in a gap past the window's edge.
    peeking: "translate-x-[calc(100%+--spacing(2))]",
    splitter: "-right-1",
  },
  [SplitterEdge.End]: {
    docked: "border-l border-separator [--column-end:var(--chrome-end)]",
    content: "left-0",
    peeking: "-translate-x-[calc(100%+--spacing(2))]",
    splitter: "-left-1",
  },
};

/**
 * A side pane of the workspace, ruled off from the main view. Closed, it keeps its width so its
 * content slides out whole, and floats over the page under the window's top row while it peeks.
 */
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
  const peeking = usePeekStore((state) => state.pane === pane) && !open;
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
      inert={!open && !peeking}
      className={cn("relative min-w-0", open && EDGE_CLASS[edge].docked)}>
      <div
        {...peekSurface}
        className={cn(
          "absolute overflow-y-auto",
          WIDTH_CLASS[pane],
          EDGE_CLASS[edge].content,
          open
            ? "inset-y-0"
            : "top-13 bottom-2 z-30 floating transition-[translate,visibility,top,bottom] duration-200 ease-out-quint motion-reduce:transition-[opacity,visibility] [html[data-pane-at-once]_&]:transition-none",
          !open && !peeking && "invisible motion-reduce:opacity-0",
          peeking && EDGE_CLASS[edge].peeking
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
          className={EDGE_CLASS[edge].splitter}
        />
      ) : null}
    </aside>
  );
}

/** The strip at the window's edge beside a closed pane: resting the pointer there shows the pane over the page. */
function PaneEdge({ pane }: { pane: Pane }) {
  const peek = usePeekStore((state) => state.peek);
  const leave = usePeekStore((state) => state.leave);

  return (
    <div
      aria-hidden
      data-peek={pane}
      className={cn(
        // Over the pane as it slides past, so the pointer resting here stays on the edge.
        "absolute inset-y-0 z-40 w-2",
        PANE_EDGE[pane] === SplitterEdge.Start ? "left-0" : "right-0"
      )}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") peek(pane, PEEK_DELAY);
      }}
      onPointerLeave={leave}
    />
  );
}

// The symbols pane's two views lie over each other; the one out of use waits to its side, unseen.
const PANE_VIEW =
  "absolute inset-0 px-2 transition-[translate,opacity,visibility] duration-200 ease-out-quint motion-reduce:translate-x-0 motion-reduce:transition-[opacity,visibility]";

/**
 * What the symbols pane shows between its header and its foot: the listings, or the settings
 * page's sections while it is open. Both stay mounted, so the listings keep their scroll, and one
 * slides aside as the other arrives.
 */
function SymbolsPaneViews() {
  const settings = useSettingsOpen();
  const navigate = useNavigate();
  const lastPage = useLastPage();

  return (
    <div className="flex h-full flex-col">
      {/* Its header holds nothing of its own, so a pane floating under the window's top row leaves it out. */}
      <div className="[.floating_&]:hidden">
        <ColumnHeader />
      </div>
      <div className="relative min-h-0 flex-1 overflow-clip">
        <div
          inert={settings}
          className={cn(
            PANE_VIEW,
            settings && "invisible -translate-x-6 opacity-0"
          )}>
          <SymbolsPane />
        </div>
        {inWindow ? (
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
        ) : null}
      </div>
      <div className="px-2">
        <SymbolsPaneFoot />
      </div>
    </div>
  );
}

/**
 * The routed main view between the side panes, each column ruled off from the next and opening
 * with its header, which together make the window's top row.
 */
function Workspace() {
  const { t } = useTranslation();
  const workspace = useRef<HTMLDivElement>(null);
  const openSearch = useListingSearchStore((state) => state.open);
  const panes = useLayoutStore((state) => state.panes);
  const settings = useSettingsOpen();
  const held = useHeldPane();

  useWorkspaceHotkeys(openSearch);
  useFollowPeek();

  const shown = mapValues(panes, ({ open }, pane) => open || pane === held);

  const column = (pane: Pane) =>
    shown[pane] ? `var(${WIDTH_VARIABLE[pane]})` : "0px";

  // Spread in, since CSSProperties does not list custom properties.
  const widths = {
    [WIDTH_VARIABLE[Pane.Symbols]]: `${panes[Pane.Symbols].width}px`,
    [WIDTH_VARIABLE[Pane.Agent]]: `${panes[Pane.Agent].width}px`,
  };

  return (
    <div className="relative h-dvh overflow-hidden text-sm">
      <ListingSearchDialog />
      <div
        ref={workspace}
        className="relative grid h-full transition-[grid-template-columns] duration-200 ease-out-quint motion-reduce:transition-none [html[data-pane-at-once]_&]:transition-none [html[data-pane-resizing]_&]:transition-none"
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
        {/* Its pages scroll under their own headers. With a pane closed, it is the column at that end of the window. */}
        <main
          className={cn(
            "@container/main min-w-0 overflow-hidden [view-transition-name:main]",
            !shown[Pane.Symbols] && "[--column-start:var(--chrome-start)]",
            !shown[Pane.Agent] && "[--column-end:var(--chrome-end)]"
          )}>
          <Outlet />
        </main>
        <SidePane
          pane={Pane.Agent}
          label={t("workspace.agent")}
          shown={shown}
          workspace={workspace}>
          <AgentPane />
        </SidePane>
        {Object.values(Pane).map((pane) =>
          shown[pane] ? null : <PaneEdge key={pane} pane={pane} />
        )}
      </div>
      <WindowControls />
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
      <BrokerModeScope>
        {onboarding ? <Outlet /> : <Workspace />}
      </BrokerModeScope>
    </I18nProvider>
  );
}
