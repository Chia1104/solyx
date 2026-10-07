import { Button } from "@heroui/react";
import { detectPlatform } from "@tanstack/react-hotkeys";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { AppLocation } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";
import { RailedColumn } from "../../components/sheet.tsx";
import { UpdateRows } from "../updates/update-rows.tsx";

import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { aboutQuery } from "./settings-query.ts";

// Matches the license in the repository's root package.json.
const LICENSE = "AGPL-3.0-or-later";

export function AboutSettings() {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(aboutQuery());

  const reveal = useMutation({
    mutationFn: (location: AppLocation) =>
      window.solyx.settings.reveal(location),
  });

  if (error) {
    return (
      <RailedColumn className="px-6 py-5">
        <LoadError error={error} onRetry={() => void refetch()} />
      </RailedColumn>
    );
  }

  if (!data) return <LoadingState />;

  const revealButton = (location: AppLocation) => (
    <Button
      size="sm"
      variant="secondary"
      onPress={() => reveal.mutate(location)}>
      {detectPlatform() === "mac"
        ? t("settings.about.reveal-mac")
        : t("settings.about.reveal")}
    </Button>
  );

  return (
    <Section
      title={data.name}
      description={
        <span className="flex items-center gap-2">
          {t("settings.about.version", { version: data.version })}
          {/* A development build is a draft, drawn in pencil like paper trading. */}
          {data.packaged ? null : (
            <span className="rounded-sm pencil px-1.5 text-xs text-foreground">
              {t("settings.about.development")}
            </span>
          )}
        </span>
      }>
      <SettingsList>
        <UpdateRows />
        <SettingsRow
          label={t("settings.about.data")}
          description={t("settings.about.data-hint")}
          value={
            <span title={data.locations[AppLocation.Data]}>
              {data.locations[AppLocation.Data]}
            </span>
          }
          actions={revealButton(AppLocation.Data)}
        />
        <SettingsRow
          label={t("settings.about.config")}
          description={t("settings.about.config-hint")}
          value={
            <span title={data.locations[AppLocation.Config]}>
              {data.locations[AppLocation.Config]}
            </span>
          }
          actions={revealButton(AppLocation.Config)}
        />
        <SettingsRow label={t("settings.about.os")} value={data.os} />
        <SettingsRow
          label={t("settings.about.electron")}
          value={data.electron}
        />
        <SettingsRow
          label={t("settings.about.chromium")}
          value={data.chromium}
        />
        <SettingsRow label={t("settings.about.node")} value={data.node} />
        <SettingsRow label={t("settings.about.license")} value={LICENSE} />
      </SettingsList>
      {reveal.error ? (
        <ErrorAlert
          title={t("common.error-title")}
          description={reveal.error.message}
        />
      ) : null}
    </Section>
  );
}
