import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";

import { cn } from "@heroui/react";
import { Link } from "@tanstack/react-router";
import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";

import type { SymbolRef } from "@solyx/core/market";

const GROUP_LABEL_HEIGHT = 20;

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

function useWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;

    if (!element) return;

    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width)
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [ref]);

  return width;
}

function Tile({
  tile,
  width,
  height,
  style,
}: {
  tile: HeatMapTile;
  width: number;
  height: number;
  style: CSSProperties;
}) {
  // The direction's colour over the surface, from a quarter at no strength to all of it.
  const depth = Math.round(25 + 75 * tile.strength);

  const description = [tile.label, tile.name, tile.value]
    .filter(Boolean)
    .join(" ");

  const className = cn(
    "absolute flex overflow-hidden px-1.5 py-1 text-xs leading-tight tabular-nums",
    tile.color && depth >= 65 ? "text-white" : "text-foreground"
  );

  const tileStyle: CSSProperties = {
    ...style,
    background: tile.color
      ? `color-mix(in oklab, ${tile.color} ${depth}%, var(--surface))`
      : "var(--default)",
  };

  const content = (
    <span
      className={cn(
        "flex min-w-0 flex-col",
        (width < 44 || height < 32) && "sr-only"
      )}>
      <span className="truncate font-semibold">{tile.label}</span>
      {tile.name && width >= 96 && height >= 52 ? (
        <span className="truncate opacity-80">{tile.name}</span>
      ) : null}
      <span>{tile.value}</span>
    </span>
  );

  return tile.symbol ? (
    <Link
      to="/symbol/$market/$symbol"
      params={tile.symbol}
      search={true}
      aria-label={description}
      title={description}
      className={cn(
        className,
        "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
      )}
      style={tileStyle}>
      {content}
    </Link>
  ) : (
    <div title={description} className={className} style={tileStyle}>
      {content}
    </div>
  );
}

/**
 * Tiles coloured by how far each moved, in labelled groups whose area adds up their tiles'
 * weights. Groups keep their order; tiles go largest first.
 */
export function HeatMap({
  groups,
  height = 256,
}: {
  groups: HeatMapGroup[];
  height?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const width = useWidth(container);

  const root = treemap<Datum>()
    .tile(treemapSquarify)
    .size([width, height])
    .paddingInner((node) => (node.depth === 0 ? 8 : 1))
    .paddingTop((node) => (node.depth === 1 ? GROUP_LABEL_HEIGHT : 0))(
    hierarchy<Datum>({
      children: groups.map((group) => ({
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

            return (
              <section
                key={group.id}
                aria-label={group.label}
                className="absolute"
                style={{
                  left: groupNode.x0,
                  top: groupNode.y0,
                  width: groupNode.x1 - groupNode.x0,
                  height: groupNode.y1 - groupNode.y0,
                }}>
                <h3
                  className="truncate text-xs text-muted"
                  style={{ lineHeight: `${GROUP_LABEL_HEIGHT}px` }}>
                  {group.label}
                </h3>
                {groupNode.children?.map((leaf) => {
                  const { tile } = leaf.data;

                  if (!tile) return null;

                  return (
                    <Tile
                      key={tile.id}
                      tile={tile}
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
