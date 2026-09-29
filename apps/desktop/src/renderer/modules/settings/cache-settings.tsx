import { useState } from "react";

import { AlertDialog, Button } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { isEnumValue } from "@solyx/utils/is";

import { MarketDataSource } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { candlesQueryKeys } from "../market/candles-query.ts";

import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { cacheUsageQuery, settingsQueryKeys } from "./settings-query.ts";

// Decimal units, as the OS file managers count sizes.
const BYTE_UNITS = [
  { unit: "gigabyte", bytes: 1e9 },
  { unit: "megabyte", bytes: 1e6 },
  { unit: "kilobyte", bytes: 1e3 },
];

function formatBytes(bytes: number, locale: string) {
  const { unit, bytes: size } = BYTE_UNITS.find(
    (candidate) => bytes >= candidate.bytes
  ) ?? { unit: "byte", bytes: 1 };

  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(bytes / size);
}

/** How much the candle cache holds per source, and clearing it after a confirmation. */
export function CacheSettings() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data, error, refetch } = useQuery(cacheUsageQuery());
  const [confirming, setConfirming] = useState(false);

  const clear = useMutation({
    mutationFn: () => window.solyx.settings.clearCache(),
    onSuccess: () => setConfirming(false),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: settingsQueryKeys.cacheUsage,
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

  return (
    <div className="flex flex-col gap-3">
      <SettingsList>
        <SettingsRow
          label={t("settings.storage.size")}
          value={formatBytes(data.bytes, i18n.language)}
        />
        {data.sources.length === 0 ? (
          <SettingsRow label={t("settings.storage.empty")} />
        ) : (
          data.sources.map((usage) => (
            <SettingsRow
              key={usage.source}
              label={
                isEnumValue(MarketDataSource, usage.source)
                  ? t(`settings.market-data.sources.${usage.source}`)
                  : usage.source
              }
              description={t("settings.storage.series", {
                count: usage.series,
              })}
              value={t("settings.storage.bars", { count: usage.bars })}
            />
          ))
        )}
      </SettingsList>
      <div>
        <AlertDialog isOpen={confirming} onOpenChange={setConfirming}>
          <Button
            size="sm"
            variant="secondary"
            isDisabled={data.sources.length === 0}>
            {t("settings.storage.clear")}
          </Button>
          <AlertDialog.Backdrop>
            <AlertDialog.Container>
              <AlertDialog.Dialog className="sm:max-w-100">
                <AlertDialog.Header>
                  <AlertDialog.Heading>
                    {t("settings.storage.confirm-title")}
                  </AlertDialog.Heading>
                </AlertDialog.Header>
                <AlertDialog.Body className="flex flex-col gap-3">
                  <p>{t("settings.storage.confirm-body")}</p>
                  {clear.error ? (
                    <ErrorAlert
                      title={t("settings.storage.clear-failed")}
                      description={clear.error.message}
                    />
                  ) : null}
                </AlertDialog.Body>
                <AlertDialog.Footer>
                  <Button slot="close" variant="tertiary">
                    {t("common.cancel")}
                  </Button>
                  <Button
                    variant="secondary"
                    isPending={clear.isPending}
                    onPress={() => clear.mutate()}>
                    {t("settings.storage.confirm")}
                  </Button>
                </AlertDialog.Footer>
              </AlertDialog.Dialog>
            </AlertDialog.Container>
          </AlertDialog.Backdrop>
        </AlertDialog>
      </div>
    </div>
  );
}
