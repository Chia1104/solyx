import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";

import { Tooltip, cn } from "@heroui/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { Link } from "@tanstack/react-router";
import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import { debounce } from "es-toolkit";
import { Button, Focusable } from "react-aria-components";
import { useTranslation } from "react-i18next";

import type { SymbolRef } from "@solyx/core/market";

import { Icon } from "./icon.tsx";

const GROUP_LABEL_HEIGHT = 20;

/** A resize counts as over once the width has held this long. */
const RESIZE_SETTLE_MS = 150;

/** Short, since a tile too small for its text says it only here. */
const TOOLTIP_DELAY = 150;

/**
 * Tiles move and recolour as a refresh or a zoom changes them, but follow a resize at once, and a
 * group coming back from a zoom fades in. Reduced motion keeps the recolouring and the fade and
 * drops the movement.
 */
const SETTLING =
  "transition-[left,top,width,height,background-color,color,opacity] duration-500 ease-in-out-quart motion-reduce:transition-[background-color,color,opacity]";

const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset";

export interface HeatMapTile {
  id: string;
  /** Opens this listing's chart when set. */
  symbol?: SymbolRef;
  label: string;
  /** A second line, shown when the tile has room. */
  name?: string;
  /** The move, as text. */
  value: string;
  weight: number;
  /** The colour of the move's direction; a tile without one did not move. */
  color?: string;
  /** How strong the move is, from 0 to 1; the colour deepens with it. */
  strength: number;
  /** What the tile's tooltip lists under its move. */
  figures?: { label: string; value: string }[];
}

export interface HeatMapGroup {
  id: string;
  label: string;
  tiles: HeatMapTile[];
}

interface Datum {
  group?: HeatMapGroup;
  tile?: HeatMapTile;
  children?: Datum[];
}

/** The element's width, and whether it is still changing; the first measure counts as a change. */
function useWidth(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, resizing: true });

  useLayoutEffect(() => {
    const element = ref.current;

    if (!element) return;

    const settle = debounce(
      () => setSize((current) => ({ ...current, resizing: false })),
      RESIZE_SETTLE_MS
    );

    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, resizing: true });
      settle();
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
      settle.cancel();
    };
  }, [ref]);

  return size;
}

/** Zooming its tiles' group in or out, and which of the two a press would do. */
interface Zoom {
  zoomed: boolean;
  toggle: () => void;
}

function Tile({
  tile,
  width,
  height,
  style,
  settling,
  zoom,
}: {
  tile: HeatMapTile;
  width: number;
  height: number;
  style: CSSProperties;
  settling: boolean;
  /** Left out where the map has one group, which leaves nothing to zoom into. */
  zoom?: Zoom;
}) {
  // The direction's colour over the surface, from a quarter at no strength to all of it.
  const depth = Math.round(25 + 75 * tile.strength);
  const title = [tile.label, tile.name].filter(Boolean).join(" ");
  const description = `${title} ${tile.value}`;

  const className = cn(
    "absolute flex overflow-hidden text-left text-xs leading-tight tabular-nums",
    tile.color && depth >= 65 ? "text-white" : "text-foreground",
    settling && SETTLING,
    FOCUS_RING
  );

  const tileStyle: CSSProperties = {
    ...style,
    backgroundColor: tile.color
      ? `color-mix(in oklab, ${tile.color} ${depth}%, var(--surface))`
      : "var(--default)",
  };

  // The padding is the text's, since a tile's own would keep it wider than a sliver's share.
  const content = (
    <span
      className={cn(
        "flex min-w-0 flex-col px-1.5 py-1",
        (width < 44 || height < 32) && "sr-only"
      )}>
      <span className="truncate font-semibold">{tile.label}</span>
      {tile.name && width >= 96 && height >= 52 ? (
        <span className="truncate opacity-80">{tile.name}</span>
      ) : null}
      <span>{tile.value}</span>
    </span>
  );

  let trigger: ReactNode;

  if (tile.symbol) {
    trigger = (
      <Focusable>
        <Link
          to="/symbol/$market/$symbol"
          params={tile.symbol}
          search={true}
          aria-label={description}
          className={className}
          style={tileStyle}>
          {content}
        </Link>
      </Focusable>
    );
  } else if (zoom) {
    trigger = (
      <Button
        aria-label={description}
        onPress={zoom.toggle}
        className={cn(
          className,
          zoom.zoomed ? "cursor-zoom-out" : "cursor-zoom-in"
        )}
        style={tileStyle}>
        {content}
      </Button>
    );
  } else {
    trigger = (
      <Focusable>
        <div
          role="img"
          aria-label={description}
          className={className}
          style={tileStyle}>
          {content}
        </div>
      </Focusable>
    );
  }

  return (
    <Tooltip delay={TOOLTIP_DELAY}>
      {trigger}
      <Tooltip.Content className="flex flex-col gap-1 tabular-nums">
        <p>
          <span className="font-semibold">{title}</span> {tile.value}
        </p>
        {tile.figures ? (
          <dl className="grid grid-cols-[auto_auto] gap-x-3 text-xs">
            {tile.figures.map((figure) => (
              <div key={figure.label} className="contents">
                <dt className="text-muted">{figure.label}</dt>
                <dd className="text-right">{figure.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Tooltip.Content>
    </Tooltip>
  );
}

/**
 * Tiles coloured by how far each moved, in labelled groups whose area adds up their tiles'
 * weights. Groups keep their order; tiles go largest first. A group's label, or a tile that opens
 * nothing, zooms the map into that group, so tiles too small to read get the whole of it.
 */
export function HeatMap({
  groups,
  height = 256,
}: {
  groups: HeatMapGroup[];
  height?: number;
}) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const { width, resizing } = useWidth(container);
  const [zoomedId, setZoomedId] = useState<string | null>(null);

  const filled = groups.filter((group) => group.tiles.length > 0);
  const zoomable = filled.length > 1;

  // A group whose tiles are gone, as when the last holding is sold, leaves the whole map.
  const zoomed = zoomable
    ? filled.find((group) => group.id === zoomedId)
    : undefined;

  const root = treemap<Datum>()
    .tile(treemapSquarify)
    .size([width, height])
    .paddingInner((node) => (node.depth === 0 ? 8 : 1))
    .paddingTop((node) => (node.depth === 1 ? GROUP_LABEL_HEIGHT : 0))(
    hierarchy<Datum>({
      children: (zoomed ? [zoomed] : groups).map((group) => ({
        group,
        children: group.tiles.map((tile) => ({ tile })),
      })),
    })
      .sum((datum) => datum.tile?.weight ?? 0)
      .sort((left, right) =>
        left.data.group ? 0 : (right.value ?? 0) - (left.value ?? 0)
      )
  );

  return (
    <div ref={container} className="relative" style={{ height }}>
      {width > 0
        ? root.children?.map((groupNode) => {
            const { group } = groupNode.data;

            if (!group || !groupNode.value) return null;

            const zoom = zoomable
              ? {
                  zoomed: zoomed !== undefined,
                  toggle: () => setZoomedId(zoomed ? null : group.id),
                }
              : undefined;

            return (
              <section
                key={group.id}
                aria-label={group.label}
                className={cn(
                  "absolute",
                  !resizing && SETTLING,
                  !resizing && "starting:opacity-0"
                )}
                style={{
                  left: groupNode.x0,
                  top: groupNode.y0,
                  width: groupNode.x1 - groupNode.x0,
                  height: groupNode.y1 - groupNode.y0,
                }}>
                <h3
                  className="flex text-xs text-muted"
                  style={{ lineHeight: `${GROUP_LABEL_HEIGHT}px` }}>
                  {zoom ? (
                    <Button
                      aria-label={
                        zoom.zoomed
                          ? t("heat-map.zoom-out")
                          : t("heat-map.zoom-in", { group: group.label })
                      }
                      onPress={zoom.toggle}
                      className={cn(
                        "flex min-w-0 items-center gap-1 rounded-sm data-hovered:text-foreground",
                        zoom.zoomed ? "cursor-zoom-out" : "cursor-zoom-in",
                        FOCUS_RING
                      )}>
                      {zoom.zoomed ? (
                        <Icon icon={ArrowLeft01Icon} className="size-3" />
                      ) : null}
                      <span className="truncate">{group.label}</span>
                    </Button>
                  ) : (
                    <span className="truncate">{group.label}</span>
                  )}
                </h3>
                {groupNode.children?.map((leaf) => {
                  const { tile } = leaf.data;

                  if (!tile) return null;

                  return (
                    <Tile
                      key={tile.id}
                      tile={tile}
                      zoom={zoom}
                      settling={!resizing}
                      width={leaf.x1 - leaf.x0}
                      height={leaf.y1 - leaf.y0}
                      style={{
                        left: leaf.x0 - groupNode.x0,
                        top: leaf.y0 - groupNode.y0,
                        width: leaf.x1 - leaf.x0,
                        height: leaf.y1 - leaf.y0,
                      }}
                    />
                  );
                })}
              </section>
            );
          })
        : null}
    </div>
  );
}
