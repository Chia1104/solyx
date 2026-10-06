import { useMutation, useQuery } from "@tanstack/react-query";
import { uniq } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { NEWS_COLLECTION_PRESETS } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { OptionSelect } from "../../components/option-select.tsx";
import { Section } from "../../components/section.tsx";
import { RailedColumn } from "../../components/sheet.tsx";

import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { newsSettingsQuery } from "./settings-query.ts";

/** How often news is collected without the agent asking. */
export function NewsSettings() {
  const { t } = useTranslation();
  const settings = useQuery(newsSettingsQuery());

  const save = useMutation({
    mutationFn: (hours: number) =>
      window.solyx.settings.setNewsCollectEveryHours(hours),
  });

  if (settings.error) {
    return (
      <RailedColumn className="px-6 py-5">
        <LoadError
          error={settings.error}
          onRetry={() => void settings.refetch()}
        />
      </RailedColumn>
    );
  }

  if (!settings.data) return <LoadingState />;

  const { collectEveryHours } = settings.data;
  const intervalLabel = t("settings.news.collect-every");

  const intervalName = (hours: number) => {
    if (hours === 0) return t("settings.news.intervals.off");

    if (hours === 24) return t("settings.news.intervals.daily");

    return hours % 24 === 0
      ? t("settings.news.intervals.days", { n: hours / 24 })
      : t("settings.news.intervals.hours", { n: hours });
  };

  // A value written by hand in the config file joins the presets.
  const intervals = uniq([
    ...NEWS_COLLECTION_PRESETS,
    collectEveryHours,
  ]).toSorted((a, b) => a - b);

  return (
    <Section
      title={t("settings.news.title")}
      description={t("settings.news.description")}>
      <div className="flex flex-col gap-3">
        <SettingsList>
          <SettingsRow
            label={intervalLabel}
            description={t("settings.news.collect-every-description")}
            actions={
              <OptionSelect
                aria-label={intervalLabel}
                className="w-44"
                value={String(collectEveryHours)}
                isDisabled={save.isPending}
                options={intervals.map((hours) => ({
                  id: String(hours),
                  label: intervalName(hours),
                }))}
                onChange={(next) => save.mutate(Number(next))}
              />
            }
          />
        </SettingsList>
        {save.error ? (
          <ErrorAlert
            title={t("settings.save-failed")}
            description={save.error.message}
          />
        ) : null}
      </div>
    </Section>
  );
}
