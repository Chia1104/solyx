import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { Secret } from "#shared/ipc/settings.ts";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";
import { AppSecretRow, SecretsUnavailable } from "../settings/secret-row.tsx";
import { SettingsList } from "../settings/settings-list.tsx";
import { secretsQuery, otlpSettingsQuery } from "../settings/settings-query.ts";
import { TextSettingRow } from "../settings/text-setting-row.tsx";

/** Where the app's traces and logs go, and the headers they are sent with. */
export function TelemetrySettings() {
  const { t } = useTranslation();
  const settings = useQuery(otlpSettingsQuery());
  const secrets = useQuery(secretsQuery());

  // Rebuilt per language so the field error comes out localized.
  const endpointSchema = useMemo(
    () =>
      z
        .string()
        .trim()
        .pipe(
          z.url({
            protocol: /^https?$/,
            error: t("settings.telemetry.endpoint-invalid"),
          })
        ),
    [t]
  );

  const failed = settings.error ?? secrets.error;

  return (
    <Section
      title={t("settings.telemetry.title")}
      description={t("settings.telemetry.description")}>
      {failed ? (
        <LoadError
          error={failed}
          onRetry={() => {
            void settings.refetch();
            void secrets.refetch();
          }}
        />
      ) : !settings.data || !secrets.data ? (
        <LoadingState />
      ) : (
        <div className="flex flex-col gap-3">
          {secrets.data.available ? null : <SecretsUnavailable />}
          <SettingsList>
            <TextSettingRow
              label={t("settings.telemetry.endpoint")}
              description={t("settings.telemetry.endpoint-description")}
              value={settings.data.endpoint ?? ""}
              isDefault={settings.data.endpoint === null}
              resetLabel={t("settings.telemetry.stop")}
              schema={endpointSchema}
              onSave={(next) => window.solyx.settings.setOtlpEndpoint(next)}
            />
            <AppSecretRow
              secret={Secret.OtlpHeaders}
              state={secrets.data.states[Secret.OtlpHeaders]}
              available={secrets.data.available}
              optional
            />
          </SettingsList>
        </div>
      )}
    </Section>
  );
}
