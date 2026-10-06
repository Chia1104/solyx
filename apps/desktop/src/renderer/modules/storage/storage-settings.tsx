import { useState } from "react";
import type { ReactNode } from "react";

import { AlertDialog, Button } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { isEnumValue } from "@solyx/utils/is";

import { MarketDataSource } from "#shared/ipc/settings.ts";
import { StoredData } from "#shared/ipc/storage.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";
import { RailedColumn } from "../../components/sheet.tsx";
import { agentQueryKeys } from "../agent/agent-query.ts";
import { useAgentStore } from "../agent/agent-store.ts";
import { candlesQueryKeys } from "../market/candles-query.ts";
import { memoryQueryKeys } from "../memory/memory-query.ts";
import { newsQueryKeys } from "../news/news-query.ts";
import { SettingsList, SettingsRow } from "../settings/settings-list.tsx";
import { watchlistQueryKeys } from "../watchlist/watchlist-query.ts";

import { storageQueryKeys, storageUsageQuery } from "./storage-query.ts";

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

/** What the rest of the workspace shows of each kind, read again once it is cleared. */
const SHOWN_ELSEWHERE: Record<StoredData, QueryKey> = {
  [StoredData.Candles]: candlesQueryKeys.all,
  [StoredData.Conversations]: agentQueryKeys.sessions,
  [StoredData.Memory]: memoryQueryKeys.all,
  [StoredData.News]: newsQueryKeys.all,
  [StoredData.Watchlist]: watchlistQueryKeys.all,
};

/** Clearing one kind of data after a confirmation. */
function ClearButton({
  data,
  isDisabled,
}: {
  data: StoredData;
  isDisabled: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const select = useAgentStore((state) => state.select);
  const [confirming, setConfirming] = useState(false);

  const clear = useMutation({
    mutationFn: () => window.solyx.storage.clear(data),
    onSuccess: () => setConfirming(false),
    onSettled: () => {
      // The conversation on screen may be gone, even when clearing stopped partway.
      if (data === StoredData.Conversations) {
        select(null);
        queryClient.removeQueries({ queryKey: agentQueryKeys.transcripts });
      }

      return Promise.all([
        queryClient.invalidateQueries({ queryKey: storageQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: SHOWN_ELSEWHERE[data] }),
      ]);
    },
  });

  return (
    <AlertDialog isOpen={confirming} onOpenChange={setConfirming}>
      <Button size="sm" variant="secondary" isDisabled={isDisabled}>
        {t(`settings.storage.${data}.clear`)}
      </Button>
      <AlertDialog.Backdrop>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-100">
            <AlertDialog.Header>
              <AlertDialog.Heading>
                {t(`settings.storage.${data}.confirm-title`)}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="flex flex-col gap-3">
              <p>{t(`settings.storage.${data}.confirm-body`)}</p>
              {clear.error ? (
                <ErrorAlert
                  title={t(`settings.storage.${data}.clear-failed`)}
                  description={clear.error.message}
                />
              ) : null}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                {t("common.cancel")}
              </Button>
              {/* Only candles can be fetched again. */}
              <Button
                variant={data === StoredData.Candles ? "secondary" : "danger"}
                isPending={clear.isPending}
                onPress={() => clear.mutate()}>
                {t(`settings.storage.${data}.confirm`)}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}

/** One kind of data: what it holds, then clearing it, which waits while it holds nothing. */
function StorageSection({
  data,
  isEmpty,
  children,
}: {
  data: StoredData;
  isEmpty: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <Section
      title={t(`settings.storage.${data}.title`)}
      description={t(`settings.storage.${data}.description`)}>
      <div className="flex flex-col gap-3">
        <SettingsList>{children}</SettingsList>
        <div>
          <ClearButton data={data} isDisabled={isEmpty} />
        </div>
      </div>
    </Section>
  );
}

/** What each kind of data the app keeps takes up, each cleared on its own after a confirmation. */
export function StorageSettings() {
  const { t, i18n } = useTranslation();
  const { data, error, refetch } = useQuery(storageUsageQuery());

  if (error) {
    return (
      <RailedColumn className="px-6 py-5">
        <LoadError error={error} onRetry={() => void refetch()} />
      </RailedColumn>
    );
  }

  if (!data) return <LoadingState />;

  const { candles, conversations, memory, news, watchlist } = data;
  const bytes = (value: number) => formatBytes(value, i18n.language);
  const count = (value: number) => value.toLocaleString(i18n.language);

  return (
    <>
      <StorageSection
        data={StoredData.Candles}
        isEmpty={candles.sources.length === 0}>
        <SettingsRow
          label={t("settings.storage.size")}
          value={bytes(candles.bytes)}
        />
        {candles.sources.length === 0 ? (
          <SettingsRow label={t("settings.storage.candles.empty")} />
        ) : (
          candles.sources.map((usage) => (
            <SettingsRow
              key={usage.source}
              label={
                isEnumValue(MarketDataSource, usage.source)
                  ? t(`settings.market-data.sources.${usage.source}`)
                  : usage.source
              }
              description={t("settings.storage.candles.series", {
                count: usage.series,
              })}
              value={t("settings.storage.candles.bars", { count: usage.bars })}
            />
          ))
        )}
      </StorageSection>
      <StorageSection
        data={StoredData.Conversations}
        isEmpty={conversations.conversations === 0}>
        <SettingsRow
          label={t("settings.storage.size")}
          value={bytes(conversations.bytes)}
        />
        <SettingsRow
          label={t("settings.storage.conversations.count")}
          value={count(conversations.conversations)}
        />
      </StorageSection>
      <StorageSection data={StoredData.Memory} isEmpty={memory.memories === 0}>
        <SettingsRow
          label={t("settings.storage.size")}
          value={bytes(memory.bytes)}
        />
        <SettingsRow
          label={t("settings.storage.memory.count")}
          value={count(memory.memories)}
        />
      </StorageSection>
      <StorageSection data={StoredData.News} isEmpty={news.items === 0}>
        <SettingsRow
          label={t("settings.storage.size")}
          value={bytes(news.bytes)}
        />
        <SettingsRow
          label={t("settings.storage.news.count")}
          value={count(news.items)}
        />
      </StorageSection>
      <StorageSection
        data={StoredData.Watchlist}
        isEmpty={watchlist.listings === 0}>
        <SettingsRow
          label={t("settings.storage.watchlist.count")}
          value={count(watchlist.listings)}
        />
      </StorageSection>
    </>
  );
}
