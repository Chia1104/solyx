import { Description, Radio, RadioGroup } from "@heroui/react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { taiwanMarketDataSourceSchema } from "@solyx/api/settings";
import type { TaiwanMarketDataSource } from "@solyx/api/settings";
import { Market } from "@solyx/core/market";

import { client } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";

/** Where Taiwan charts come from; charts switch as soon as another source is picked. */
export function MarketDataSourceSelect({
  source,
  label,
}: {
  source: TaiwanMarketDataSource;
  label: string;
}) {
  const { t } = useTranslation();

  const save = useMutation({
    mutationFn: (next: TaiwanMarketDataSource) =>
      client.settings.setMarketDataSource({ market: Market.TW, source: next }),
  });

  return (
    <div className="flex flex-col gap-3">
      <RadioGroup
        aria-label={label}
        value={source}
        isDisabled={save.isPending}
        onChange={(next) => {
          const picked = taiwanMarketDataSourceSchema.safeParse(next);

          if (picked.success && picked.data !== source)
            save.mutate(picked.data);
        }}>
        {taiwanMarketDataSourceSchema.options.map((option) => (
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
