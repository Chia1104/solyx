import { Fragment, useEffect, useId, useRef } from "react";

import { prefersReducedMotion, useInView } from "../../lib/motion.ts";

/** A 3×5 block face per character; `#` is a filled cell. */
const FONT = {
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  E: ["###", "#..", "###", "#..", "###"],
  O: ["###", "#.#", "#.#", "#.#", "###"],
  R: ["###", "#.#", "###", "##.", "#.#"],
} satisfies Record<string, string[]>;

export type Glyph = keyof typeof FONT;

const ROWS = 5;

const UNIT = 32;

/** Slab height, in cells. */
const HEIGHT = 0.5;

/** How far construction lines run past the letters, in cells. */
const GUIDE_REACH = 16;

const COS30 = Math.cos(Math.PI / 6);

type Vec = readonly [number, number, number];

const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

const negate = (a: Vec): Vec => [-a[0], -a[1], -a[2]];

/** Isometric projection with +z up; the viewer looks down from +x, +y, +z. */
const project = ([x, y, z]: Vec): [number, number] => [
  (x - y) * COS30 * UNIT,
  ((x + y) / 2 - z * HEIGHT) * UNIT,
];

const point = (vec: Vec) =>
  project(vec)
    .map((value) => Math.round(value * 100) / 100)
    .join(" ");

/** The faces a viewer can see, each spanned by `u` and `v` from the corner at `voxel + normal`. */
const VISIBLE_FACES: { normal: Vec; u: Vec; v: Vec; hatched: boolean }[] = [
  { normal: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], hatched: false },
  { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], hatched: false },
  { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], hatched: true },
];

interface Face {
  outline: string;
  edges: string;
  hatched: boolean;
}

/**
 * Lays the glyphs flat on the ground as slabs, reading up and to the right with their tops toward
 * the viewer, and lists the visible faces far to near so later ones cover what they hide. An edge
 * is drawn only where the surface folds or ends, so a letter reads as one solid, not a pile of cubes.
 */
function buildScene(glyphs: readonly Glyph[]) {
  const voxels: Vec[] = [];
  let column = 0;

  for (const glyph of glyphs) {
    FONT[glyph].forEach((row, rowIndex) => {
      [...row].forEach((cell, cellIndex) => {
        if (cell === "#") voxels.push([rowIndex, -(column + cellIndex + 1), 0]);
      });
    });
    column += (FONT[glyph][0]?.length ?? 0) + 1;
  }

  const columns = column - 1;
  const occupied = new Set(voxels.map((voxel) => voxel.join()));
  const has = (voxel: Vec) => occupied.has(voxel.join());

  const faces: Face[] = [];
  const xs: number[] = [];
  const ys: number[] = [];

  const byDepth = voxels.toSorted(
    (a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2])
  );

  for (const voxel of byDepth) {
    for (const { normal, u, v, hatched } of VISIBLE_FACES) {
      if (has(add(voxel, normal))) continue;

      const origin = add(voxel, normal);

      const corners: [Vec, Vec, Vec, Vec] = [
        origin,
        add(origin, u),
        add(add(origin, u), v),
        add(origin, v),
      ];

      for (const corner of corners) {
        const [x, y] = project(corner);
        xs.push(x);
        ys.push(y);
      }

      const sides: [Vec, Vec, Vec][] = [
        [corners[0], corners[1], negate(v)],
        [corners[1], corners[2], u],
        [corners[2], corners[3], v],
        [corners[3], corners[0], negate(u)],
      ];

      const edges = sides
        .filter(([, , toward]) => {
          const neighbour = add(voxel, toward);

          return !has(neighbour) || has(add(neighbour, normal));
        })
        .map(([from, to]) => `M${point(from)}L${point(to)}`)
        .join("");

      faces.push({
        outline: `M${corners.map(point).join("L")}Z`,
        edges,
        hatched,
      });
    }
  }

  const minX = Math.min(...xs) - 1;
  const minY = Math.min(...ys) - 1;
  const guide = (from: Vec, to: Vec) => `M${point(from)}L${point(to)}`;

  return {
    faces,
    viewBox: {
      x: minX,
      y: minY,
      width: Math.max(...xs) + 1 - minX,
      height: Math.max(...ys) + 1 - minY,
    },
    /** Construction lines along the ground: the baseline and the two ends of the word. */
    guides: [
      guide([ROWS, GUIDE_REACH, 0], [ROWS, -columns - GUIDE_REACH, 0]),
      guide([-GUIDE_REACH, 0, 0], [GUIDE_REACH, 0, 0]),
      guide([-GUIDE_REACH, -columns, 0], [GUIDE_REACH, -columns, 0]),
    ].join(""),
  };
}

/**
 * Block letters drafted in pencil as an isometric line figure: hatched tops, blank sides and
 * hairline edges on dashed construction lines. The pointer works as a pen, inking the edges near it.
 */
export function IsometricMark({
  glyphs,
  className,
}: {
  glyphs: readonly Glyph[];
  className?: string;
}) {
  const id = useId();

  const ids = {
    hatch: `isometric-hatch-${id}`,
    pen: `isometric-pen-${id}`,
    mask: `isometric-mask-${id}`,
    scene: `isometric-scene-${id}`,
  };

  const svgRef = useRef<SVGSVGElement>(null);
  const penRef = useRef<SVGRadialGradientElement>(null);
  const inView = useInView(svgRef);
  const { faces, viewBox, guides } = buildScene(glyphs);

  useEffect(() => {
    if (
      !inView ||
      prefersReducedMotion() ||
      window.matchMedia("(hover: none)").matches
    )
      return;

    const onPointerMove = (event: PointerEvent) => {
      const matrix = svgRef.current?.getScreenCTM()?.inverse();
      const pen = penRef.current;

      if (!matrix || !pen) return;

      const { x, y } = new DOMPoint(
        event.clientX,
        event.clientY
      ).matrixTransform(matrix);

      pen.setAttribute("cx", String(x));
      pen.setAttribute("cy", String(y));
    };

    window.addEventListener("pointermove", onPointerMove);

    return () => window.removeEventListener("pointermove", onPointerMove);
  }, [inView]);

  return (
    <svg
      ref={svgRef}
      aria-hidden="true"
      className={className}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      preserveAspectRatio="xMidYMid meet"
      fill="none"
      overflow="visible">
      <defs>
        <pattern
          id={ids.hatch}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse">
          <path d="M-1 1l2 -2M0 8l8 -8M7 9l2 -2" stroke="var(--hatch)" />
        </pattern>
        {/* Starts on the letters' centre, so the figure is partly inked before the pointer moves. */}
        <radialGradient
          ref={penRef}
          id={ids.pen}
          cx={viewBox.x + viewBox.width / 2}
          cy={viewBox.y + viewBox.height / 2}
          r={Math.max(viewBox.width, viewBox.height) * 0.4}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id={ids.mask} maskUnits="userSpaceOnUse" {...viewBox}>
          <rect {...viewBox} fill={`url(#${ids.pen})`} />
        </mask>
        <g id={ids.scene}>
          {faces.map((face) => (
            <Fragment key={face.outline}>
              <path d={face.outline} fill="var(--background)" stroke="none" />
              {face.hatched && (
                <path
                  d={face.outline}
                  fill={`url(#${ids.hatch})`}
                  stroke="none"
                />
              )}
              <path
                d={face.edges}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </Fragment>
          ))}
        </g>
      </defs>
      <path
        d={guides}
        stroke="color-mix(in oklab, var(--graphite) 45%, transparent)"
        strokeDasharray="4 3"
        vectorEffect="non-scaling-stroke"
      />
      <use
        href={`#${ids.scene}`}
        stroke="color-mix(in oklab, var(--graphite) 75%, transparent)"
      />
      <use
        href={`#${ids.scene}`}
        stroke="var(--primary)"
        mask={`url(#${ids.mask})`}
      />
    </svg>
  );
}
