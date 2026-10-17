import { DotGrid, RadialGradient, Ripples, Shader } from "shaders/react";

import { prefersReducedMotion } from "../../lib/motion.ts";
import { useSheetColors } from "../../lib/use-sheet-colors.ts";

export interface InkRipplesProps {
  /** Where the signed order sits, as a fraction of the canvas. */
  center: { x: number; y: number };
  /** Pixels between dots. */
  pitch: number;
  height: number;
}

/**
 * Halftone rings spreading from a signed order, as ink spreads into paper. The rings size the dots
 * and a radial fade thins them with distance; neither is drawn itself.
 */
export function InkRipples({ center, pitch, height }: InkRipplesProps) {
  const colors = useSheetColors();

  if (!colors || height === 0) return null;

  return (
    <Shader className="absolute inset-0" disableTelemetry>
      <Ripples
        id="rings"
        visible={false}
        center={center}
        colorA="#ffffff"
        colorB="#000000"
        frequency={18}
        thickness={0.4}
        softness={0.6}
        speed={prefersReducedMotion() ? 0 : -0.35}
      />
      <RadialGradient
        id="reach"
        visible={false}
        center={center}
        radius={0.75}
        colorA="#000000"
        colorB="#00000000"
      />
      <DotGrid
        color={colors.primaryForeground}
        density={Math.round(height / pitch)}
        opacity={0.35}
        maskSource="reach"
        maskType="alpha"
        dotSize={{
          type: "map",
          source: "rings",
          channel: "luminance",
          inputMin: 0,
          inputMax: 1,
          outputMin: 0,
          outputMax: 0.6,
        }}
      />
    </Shader>
  );
}
