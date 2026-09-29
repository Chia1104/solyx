import { Description, Label, ListBox, Select } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Market } from "@solyx/core/market";
import { isEnumValue } from "@solyx/utils/is";

import { MarketDataSource } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { candlesQueryKeys } from "../market/candles-query.ts";

import { marketDataQuery, settingsQueryKeys } from "./settings-query.ts";

/** Where Taiwan charts come from; each source is set up in its own section. */
export function MarketDataSourceSelect() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, error, refetch } = useQuery(marketDataQuery());

  const save = useMutation({
    mutationFn: (source: MarketDataSource) =>
      window.solyx.settings.setMarketDataSource(Market.TW, source),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: settingsQueryKeys.marketData,
        }),
        queryClient.invalidateQueries({ queryKey: candlesQueryKeys.all }),
      ]),
  });

  if (error) {
    return (
      <ErrorAlert
        title={t("common.load-failed")}
        description={error.message}
        onRetry={() => void refetch()}
      />
    );
  }

  if (!data) return <LoadingState />;

  const current = data.markets[Market.TW];

  if (!current) return null;

  return (
    <div className="flex flex-col gap-3">
      <Select
        className="max-w-xs"
        value={current.source}
        isDisabled={save.isPending}
        onChange={(key) => {
          if (
            key !== null &&
            isEnumValue(MarketDataSource, key) &&
            key !== current.source
          ) {
            save.mutate(key);
          }
        }}>
        <Label>{t("settings.market-data.tw-source")}</Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Description>
          {t("settings.market-data.source-description")}
        </Description>
        <Select.Popover>
          <ListBox>
            {Object.values(MarketDataSource).map((source) => (
              <ListBox.Item
                key={source}
                id={source}
                textValue={t(`settings.market-data.sources.${source}`)}>
                {t(`settings.market-data.sources.${source}`)}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
      <p className="text-sm text-muted">
        {t("settings.market-data.edit-file", { file: data.file })}
      </p>
      {save.error ? (
        <ErrorAlert
          title={t("settings.market-data.save-failed")}
          description={save.error.message}
        />
      ) : null}
    </div>
  );
}
