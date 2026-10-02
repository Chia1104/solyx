import { useCallback } from "react";

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { isEnumValue } from "@solyx/utils/is";

import { Palette } from "#shared/palette.ts";

import { appearanceQuery } from "./settings-query.ts";

/** Names a palette: a built-in one in the app's language, the user's own by its name or else its id. */
export function usePaletteName() {
  const { t } = useTranslation();
  const { data } = useQuery(appearanceQuery());

  return useCallback(
    (palette: string) =>
      isEnumValue(Palette, palette)
        ? t(`settings.palettes.${palette}`)
        : (data?.palettes[palette]?.name ?? palette),
    [t, data]
  );
}
