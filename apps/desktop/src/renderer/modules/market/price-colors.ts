import { useMemo } from "react";

import { useSuspenseQuery } from "@tanstack/react-query";

import { Market } from "@solyx/core/market";

import { PriceColors } from "#shared/ipc/settings.ts";
import type { Appearance } from "#shared/ipc/settings.ts";

import { usePaletteColors } from "../../app/theme.ts";
import { appearanceQuery } from "../settings/settings-query.ts";

interface PriceColor {
  solid: string;
  faded: string;
  /** The class for quote text, which takes the palette's quote pair rather than the candles'. */
  text: string;
}

export interface DirectionColors {
  rise: PriceColor;
  fall: PriceColor;
}

// Taiwan quotes rising prices in red and falling ones in green; US quotes do the opposite.
const RISES_RED: Record<PriceColors, Record<Market, boolean>> = {
  [PriceColors.Market]: { [Market.TW]: true, [Market.US]: false },
  [PriceColors.RedUp]: { [Market.TW]: true, [Market.US]: true },
  [PriceColors.GreenUp]: { [Market.TW]: false, [Market.US]: false },
};

// 45% opaque, as the alpha of an 8-digit hex colour.
const FADED_ALPHA = "73";

const selectPriceColors = (appearance: Appearance) => appearance.priceColors;

function priceColor(solid: string, text: string): PriceColor {
  return { solid, faded: `${solid}${FADED_ALPHA}`, text };
}

/** The colours of a rise and a fall in `market`, as the user prefers them in the current scheme. */
export function useDirectionColors(market: Market): DirectionColors {
  const colors = usePaletteColors();

  const { data: priceColors } = useSuspenseQuery({
    ...appearanceQuery(),
    select: selectPriceColors,
  });

  const risesRed = RISES_RED[priceColors][market];

  return useMemo(() => {
    const red = priceColor(colors.candleRed, "text-quote-red");
    const green = priceColor(colors.candleGreen, "text-quote-green");

    return risesRed ? { rise: red, fall: green } : { rise: green, fall: red };
  }, [colors, risesRed]);
}
