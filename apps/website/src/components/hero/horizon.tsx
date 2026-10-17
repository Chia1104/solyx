import { useEffect, useState } from "react";

import {
  Circle,
  FlowingGradient,
  Group,
  Paper,
  Shader,
  SolidColor,
  Stripes,
} from "shaders/react";

import { useSheetColors } from "../../lib/use-sheet-colors.ts";

export interface Sun {
  /** Center, in pixels from the hero's left edge. */
  x: number;
  /** Radius in pixels. */
  radius: number;
}

export interface HorizonProps {
  width: number;
  height: number;
  /** The horizon's distance from the hero's top, in pixels. */
  horizon: number;
  sun: Sun;
  /** Called once the canvas first draws. */
  onReady: () => void;
  /** Called when this browser cannot run the canvas, which then stays empty. */
  onUnavailable: () => void;
}

const RISE_MS = 1800;

function easeOutQuint(t: number): number {
  return 1 - (1 - t) ** 5;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The app icon's emblem drawn on the GPU: a disc rises through the horizon, hatched in pencil
 * below it and inked above it, the way a draft becomes an order once the user signs it.
 */
export function Horizon({
  width,
  height,
  horizon,
  sun,
  onReady,
  onUnavailable,
}: HorizonProps) {
  const colors = useSheetColors();
  const [ready, setReady] = useState(false);
  const [rise, setRise] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    if (!ready) return;

    if (prefersReducedMotion()) {
      setStill(true);
      setRise(1);

      return;
    }

    const start = performance.now();

    let frame = requestAnimationFrame(function step(now) {
      const progress = Math.min((now - start) / RISE_MS, 1);
      setRise(easeOutQuint(progress));

      if (progress < 1) frame = requestAnimationFrame(step);
    });

    return () => cancelAnimationFrame(frame);
  }, [ready]);

  if (!colors || width === 0 || height === 0) return null;

  const centerY = horizon + sun.radius * (1 - rise);
  const center = { x: sun.x / width, y: centerY / height };
  // A radius of one spans the canvas height edge to edge.
  const radius = (2 * sun.radius) / height;
  const above = horizon / height;

  const sky = {
    x: { unit: "uv", value: 0 },
    y: { unit: "uv", value: 0 },
    width: { unit: "uv", value: 1 },
    height: { unit: "uv", value: above },
    rotation: 0,
  } as const;

  const sea = {
    ...sky,
    y: { unit: "uv", value: above },
    height: { unit: "uv", value: 1 - above },
  } as const;

  return (
    <Shader
      className="absolute inset-0"
      disableTelemetry
      onReady={() => {
        setReady(true);
        onReady();
      }}
      onUnavailable={onUnavailable}>
      <Circle id="disc" visible={false} center={center} radius={radius} />

      <Group boundingBox={sea} maskSource="disc">
        <SolidColor color={colors.sheet} />
        <Stripes
          colorA={colors.graphite}
          colorB={colors.sheet}
          angle={-45}
          density={Math.round(height / 11)}
          balance={0.14}
          speed={still ? 0 : 0.015}
        />
        <Paper roughness={0.2} grainScale={1.4} displacement={0.35} />
      </Group>

      <Group boundingBox={sky} maskSource="disc">
        <FlowingGradient
          colorA={colors.ink}
          colorB={colors.inkDeep}
          colorC={colors.ink}
          colorD={colors.inkLight}
          speed={still ? 0 : 0.25}
          distortion={0.25}
        />
      </Group>
    </Shader>
  );
}
