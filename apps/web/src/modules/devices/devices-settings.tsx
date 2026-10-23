import { Button, Switch } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { useClock } from "../../app/clock.ts";
import { orpc } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { Section } from "../../components/section.tsx";
import { SettingsList, SettingsRow } from "../settings/settings-list.tsx";

import { pairedDevicesQuery, remoteAccessQuery } from "./devices-query.ts";

/** Whether paired browsers reach the workspace, how to reach it, pairing one and the ones paired. */
export function DevicesSettings() {
  const { t } = useTranslation();
  const clock = useClock();
  const { data: access } = useQuery(remoteAccessQuery());
  const { data: devices } = useQuery(pairedDevicesQuery());

  const enable = useMutation(orpc.devices.setEnabled.mutationOptions());
  const pairing = useMutation(orpc.devices.pairingCode.mutationOptions());
  const remove = useMutation(orpc.devices.remove.mutationOptions());

  if (!access) return null;

  return (
    <Section title={t("settings.devices.title")}>
      <SettingsList>
        <SettingsRow
          label={t("settings.devices.enabled")}
          description={t("settings.devices.enabled-description")}
          actions={
            <Switch
              isSelected={access.enabled}
              isDisabled={enable.isPending}
              onChange={(enabled) => enable.mutate(enabled)}>
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <span className="sr-only">{t("settings.devices.enabled")}</span>
              </Switch.Content>
            </Switch>
          }>
          {enable.error ? (
            <ErrorAlert
              title={t("settings.save-failed")}
              description={enable.error.message}
            />
          ) : null}
          {access.error ? (
            <ErrorAlert
              title={t("settings.devices.listen-failed")}
              description={access.error}
            />
          ) : null}
        </SettingsRow>
        {access.url ? (
          <SettingsRow
            label={t("settings.devices.address")}
            description={t("settings.devices.address-description", {
              port: access.port,
            })}>
            <code className="font-mono text-sm select-all">{access.url}</code>
          </SettingsRow>
        ) : null}
        {access.url ? (
          <SettingsRow
            label={t("settings.devices.pair")}
            description={t("settings.devices.pair-description")}
            actions={
              <Button
                size="sm"
                variant="secondary"
                isPending={pairing.isPending}
                onPress={() => pairing.mutate(undefined)}>
                {pairing.data
                  ? t("settings.devices.new-code")
                  : t("settings.devices.show-code")}
              </Button>
            }>
            {pairing.data ? (
              <p className="text-sm">
                <code className="font-mono text-lg tracking-widest select-all">
                  {pairing.data.code}
                </code>{" "}
                <span className="text-muted">
                  {t("settings.devices.code-expires", {
                    time: clock.time(pairing.data.expiresAt),
                  })}
                </span>
              </p>
            ) : null}
            {pairing.error ? (
              <ErrorAlert
                title={t("settings.save-failed")}
                description={pairing.error.message}
              />
            ) : null}
          </SettingsRow>
        ) : null}
        {devices?.map((device) => (
          <SettingsRow
            key={device.id}
            label={device.name}
            description={t(
              device.signs
                ? "settings.devices.paired-with-passkey"
                : "settings.devices.paired-at",
              { date: clock.date(device.pairedAt) }
            )}
            actions={
              <Button
                size="sm"
                variant="tertiary"
                isPending={remove.isPending && remove.variables === device.id}
                onPress={() => remove.mutate(device.id)}>
                {t("settings.devices.remove")}
              </Button>
            }
          />
        ))}
      </SettingsList>
      {remove.error ? (
        <ErrorAlert
          title={t("settings.save-failed")}
          description={remove.error.message}
        />
      ) : null}
    </Section>
  );
}
