import { Description, Radio, RadioGroup } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Market } from "@solyx/core/market";
import { isEnumValue } from "@solyx/utils/is";

import { MarketDataSource } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { candlesQueryKeys } from "../market/candles-query.ts";

import { settingsQueryKeys } from "./settings-query.ts";

/** Where Taiwan charts come from; charts switch as soon as another source is picked. */
export function MarketDataSourceSelect({
  source,
  label,
}: {
  source: MarketDataSource;
  label: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: (next: MarketDataSource) =>
      window.solyx.settings.setMarketDataSource(Market.TW, next),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: settingsQueryKeys.marketData,
        }),
        queryClient.invalidateQueries({ queryKey: candlesQueryKeys.all }),
      ]),
  });

  return (
    <div className="flex flex-col gap-3">
      <RadioGroup
        aria-label={label}
        value={source}
        isDisabled={save.isPending}
        onChange={(next) => {
          if (isEnumValue(MarketDataSource, next) && next !== source) {
            save.mutate(next);
          }
        }}>
        {Object.values(MarketDataSource).map((option) => (
          <Radio key={option} value={option}>
            <Radio.Content>
              <Radio.Control>
                <Radio.Indicator />
              </Radio.Control>
              {t(`settings.market-data.sources.${option}`)}
            </Radio.Content>
            <Description>
              {t(`settings.market-data.source-hints.${option}`)}
            </Description>
          </Radio>
        ))}
      </RadioGroup>
      {save.error ? (
        <ErrorAlert
          title={t("settings.save-failed")}
          description={save.error.message}
        />
      ) : null}
    </div>
  );
}
