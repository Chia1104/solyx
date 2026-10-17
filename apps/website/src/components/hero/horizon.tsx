import { useEffect, useState } from "react";

import {
  Circle,
  DotGrid,
  FlowingGradient,
  RadialGradient,
  Shader,
} from "shaders/react";

import { prefersReducedMotion } from "../../lib/motion.ts";
import { useSheetColors } from "../../lib/use-sheet-colors.ts";

import { DOT_PITCH, HALO_REACH } from "./sun.ts";

export interface HorizonProps {
  width: number;
  height: number;
  /** The sun's radius in pixels; it rises through the canvas's bottom edge, the horizon. */
  sun: number;
  /** Called once the canvas first draws. */
  onReady: () => void;
  /** Called when this browser cannot run the canvas, which then stays empty. */
  onUnavailable: () => void;
}

const RISE_MS = 1800;

/** How far around the pointer the dots take ink, in pixels. */
const PEN_RADIUS = 220;

function easeOutQuint(t: number): number {
  return 1 - (1 - t) ** 5;
}

/**
 * The app icon's emblem drawn on the GPU: an inked sun rises through the horizon with a halftone
 * halo that grows with it, the way a draft becomes an order once the user signs it. The pointer
 * inks the dots it passes over.
 */
export function Horizon({
  width,
  height,
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

  if (!colors || width === 0 || height === 0 || sun === 0) return null;

  const center = { x: 0.5, y: (height + sun * (1 - rise)) / height };

  return (
    <Shader
      className="absolute inset-0"
      disableTelemetry
      onReady={() => {
        setReady(true);
        onReady();
      }}
      onUnavailable={onUnavailable}>
      {/* Opaque at the sun's edge and clear at the halo's reach; it sizes the dots, which shrink outward. */}
      <RadialGradient
        id="halo"
        visible={false}
        center={center}
        radius={((sun * HALO_REACH) / height) * rise}
        stops={[
          { color: "#000000", position: 0 },
          { color: "#000000", position: 1 / HALO_REACH },
          { color: "#00000000", position: 1 },
        ]}
      />
      <DotGrid
        color={colors.primary}
        density={Math.round(height / DOT_PITCH)}
        dotSize={{
          type: "map",
          source: "halo",
          channel: "alpha",
          inputMin: 0,
          inputMax: 1,
          outputMin: 0,
          outputMax: 0.7,
        }}
      />

      {/* The pointer is a pen: the dots under it take ink, trailing a little as it moves. */}
      <RadialGradient
        id="pen"
        visible={false}
        center={{ type: "mouse-position", smoothing: 0.18, momentum: 0.12 }}
        radius={PEN_RADIUS / height}
        stops={[
          { color: "#000000", position: 0 },
          { color: "#00000000", position: 1 },
        ]}
      />
      <DotGrid
        color={colors.primary}
        density={Math.round(height / DOT_PITCH)}
        opacity={0.85}
        dotSize={{
          type: "map",
          source: "pen",
          channel: "alpha",
          inputMin: 0,
          inputMax: 1,
          outputMin: 0,
          outputMax: 0.6,
        }}
      />

      <Circle
        id="disc"
        visible={false}
        center={center}
        radius={(2 * sun) / height}
      />
      <FlowingGradient
        maskSource="disc"
        colorA={colors.primary}
        colorB={colors.primaryDeep}
        colorC={colors.primary}
        colorD={colors.primaryLight}
        speed={still ? 0 : 0.25}
        distortion={0.25}
      />
    </Shader>
  );
}
