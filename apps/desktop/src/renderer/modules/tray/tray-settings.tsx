import { Switch } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { Section } from "../../components/section.tsx";
import { SettingsList, SettingsRow } from "../settings/settings-list.tsx";
import { traySettingsQuery } from "../settings/settings-query.ts";

/** Whether the app stays open in the tray once its last window closes, and leaves the Dock then. */
export function TraySettings() {
  const { t } = useTranslation();
  const { data } = useQuery(traySettingsQuery());

  const show = useMutation({
    mutationFn: (shown: boolean) => window.solyx.settings.setTrayShown(shown),
  });

  const hideDock = useMutation({
    mutationFn: (hidden: boolean) =>
      window.solyx.settings.setDockHidden(hidden),
  });

  if (!data) return null;

  // Only macOS has a Dock, and its tray is the menu bar.
  const showLabel = data.hasDock
    ? t("settings.tray.show-menu-bar")
    : t("settings.tray.show-system-tray");

  return (
    <Section title={t("settings.tray.title")}>
      <SettingsList>
        <SettingsRow
          label={showLabel}
          description={t("settings.tray.show-description")}
          actions={
            <Switch
              isSelected={data.show}
              isDisabled={show.isPending}
              onChange={(shown) => show.mutate(shown)}>
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <span className="sr-only">{showLabel}</span>
              </Switch.Content>
            </Switch>
          }>
          {show.error ? (
            <ErrorAlert
              title={t("settings.save-failed")}
              description={show.error.message}
            />
          ) : null}
        </SettingsRow>
        {data.hasDock ? (
          <SettingsRow
            label={t("settings.tray.hide-dock")}
            description={t("settings.tray.hide-dock-description")}
            actions={
              <Switch
                isSelected={data.show && data.hideDock}
                isDisabled={!data.show || hideDock.isPending}
                onChange={(hidden) => hideDock.mutate(hidden)}>
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <span className="sr-only">
                    {t("settings.tray.hide-dock")}
                  </span>
                </Switch.Content>
              </Switch>
            }>
            {hideDock.error ? (
              <ErrorAlert
                title={t("settings.save-failed")}
                description={hideDock.error.message}
              />
            ) : null}
          </SettingsRow>
        ) : null}
      </SettingsList>
    </Section>
  );
}
