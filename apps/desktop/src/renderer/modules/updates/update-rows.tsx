import { Button, Switch } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { UpdateStatus } from "#shared/ipc/updates.ts";
import type { UpdateState } from "#shared/ipc/updates.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { SettingsRow } from "../settings/settings-list.tsx";
import { updateSettingsQuery } from "../settings/settings-query.ts";

import { UpdateAction } from "./update-action.tsx";
import { updateStateQuery } from "./updates-query.ts";

function StatusText({ state }: { state: UpdateState }) {
  const { t } = useTranslation();

  return "version" in state
    ? t(`updates.status.${state.status}`, { version: state.version })
    : t(`updates.status.${state.status}`);
}

/** Whether the app checks for updates on its own, and how the latest check went. */
export function UpdateRows() {
  const { t } = useTranslation();
  const { data: state } = useQuery(updateStateQuery());
  const { data: settings } = useQuery(updateSettingsQuery());

  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      window.solyx.settings.setUpdateChecks(enabled),
  });

  const check = useMutation({
    mutationFn: () => window.solyx.updates.check(),
  });

  if (!state || !settings || state.status === UpdateStatus.Unsupported) {
    return null;
  }

  const busy =
    state.status === UpdateStatus.Checking ||
    state.status === UpdateStatus.Downloading;

  const waiting =
    state.status === UpdateStatus.Ready ||
    state.status === UpdateStatus.Available;

  return (
    <>
      <SettingsRow
        label={t("updates.automatic")}
        description={t("updates.automatic-description")}
        actions={
          <Switch
            isSelected={settings.check}
            isDisabled={toggle.isPending}
            onChange={(enabled) => toggle.mutate(enabled)}>
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <span className="sr-only">{t("updates.automatic")}</span>
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
      <SettingsRow
        label={t("updates.title")}
        value={<StatusText state={state} />}
        actions={
          waiting ? (
            <UpdateAction />
          ) : (
            <Button
              size="sm"
              variant="secondary"
              isDisabled={busy}
              onPress={() => check.mutate()}>
              {t("updates.check-now")}
            </Button>
          )
        }>
        {state.status === UpdateStatus.Failed ? (
          <ErrorAlert
            title={t("updates.status.failed")}
            description={state.error}
          />
        ) : null}
      </SettingsRow>
    </>
  );
}
