import { useId } from "react";

import { Description, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { PriceColors } from "@solyx/api/settings";
import { isEnumValue } from "@solyx/utils/is";

import { orpc } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";

import { appearanceQuery } from "./settings-query.ts";

export function PriceColorsSelect() {
  const { t } = useTranslation();
  const labelId = useId();
  const descriptionId = useId();
  const { data } = useQuery(appearanceQuery());

  // The main process pushes the saved appearance, which the query takes.
  const save = useMutation(orpc.settings.setPriceColors.mutationOptions());

  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-sm font-medium">
        {t("settings.price-colors")}
      </span>
      <ToggleButtonGroup
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        selectionMode="single"
        disallowEmptySelection
        size="sm"
        isDisabled={!data || save.isPending}
        selectedKeys={data ? [data.priceColors] : []}
        onSelectionChange={(keys) => {
          const [next] = keys;

          if (next !== undefined && isEnumValue(PriceColors, next))
            save.mutate(next);
        }}>
        {Object.values(PriceColors).map((priceColors) => (
          <ToggleButton key={priceColors} id={priceColors}>
            {t(`settings.price-colors-options.${priceColors}`)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Description id={descriptionId}>
        {t("settings.price-colors-description")}
      </Description>
      {save.error ? (
        <ErrorAlert
          title={t("settings.save-failed")}
          description={save.error.message}
        />
      ) : null}
    </div>
  );
}
