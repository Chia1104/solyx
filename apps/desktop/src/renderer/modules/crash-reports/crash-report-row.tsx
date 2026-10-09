import { Switch } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { Section } from "../../components/section.tsx";
import { SettingsList, SettingsRow } from "../settings/settings-list.tsx";
import { crashReportSettingsQuery } from "../settings/settings-query.ts";

/** Whether the user sends crash reports, and what a report holds. */
export function CrashReportRow() {
  const { t } = useTranslation();
  const { data: settings } = useQuery(crashReportSettingsQuery());

  const toggle = useMutation({
    mutationFn: (send: boolean) => window.solyx.settings.setCrashReports(send),
  });

  if (!settings) return null;

  return (
    <SettingsRow
      label={t("crash-reports.send")}
      description={t("crash-reports.send-description")}
      value={settings.available ? null : t("crash-reports.unavailable")}
      actions={
        <Switch
          isSelected={settings.send}
          isDisabled={toggle.isPending}
          onChange={(send) => toggle.mutate(send)}>
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            <span className="sr-only">{t("crash-reports.send")}</span>
          </Switch.Content>
        </Switch>
      }>
      {toggle.error ? (
        <ErrorAlert
          title={t("settings.save-failed")}
          description={toggle.error.message}
        />
      ) : null}
    </SettingsRow>
  );
}

/** First-run setup's ask: why reports help, and that nothing is sent until the user agrees. */
export function CrashReportSection() {
  const { t } = useTranslation();

  return (
    <Section
      title={t("crash-reports.title")}
      description={t("crash-reports.description")}>
      <SettingsList>
        <CrashReportRow />
      </SettingsList>
    </Section>
  );
}
