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
import {
  secretsQuery,
  traceSettingsQuery,
} from "../settings/settings-query.ts";
import { TextSettingRow } from "../settings/text-setting-row.tsx";

/** Where the app's traces go, and the headers they are sent with. */
export function TraceSettings() {
  const { t } = useTranslation();
  const settings = useQuery(traceSettingsQuery());
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
            error: t("settings.traces.endpoint-invalid"),
          })
        ),
    [t]
  );

  const failed = settings.error ?? secrets.error;

  return (
    <Section
      title={t("settings.traces.title")}
      description={t("settings.traces.description")}>
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
              label={t("settings.traces.endpoint")}
              description={t("settings.traces.endpoint-description")}
              value={settings.data.endpoint ?? ""}
              isDefault={settings.data.endpoint === null}
              resetLabel={t("settings.traces.stop")}
              schema={endpointSchema}
              onSave={(next) => window.solyx.settings.setTraceEndpoint(next)}
            />
            <AppSecretRow
              secret={Secret.TraceHeaders}
              state={secrets.data.states[Secret.TraceHeaders]}
              available={secrets.data.available}
              optional
            />
          </SettingsList>
        </div>
      )}
    </Section>
  );
}
