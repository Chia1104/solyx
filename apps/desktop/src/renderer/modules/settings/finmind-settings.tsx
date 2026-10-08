import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { FinMindPlan } from "@solyx/fundamentals/finmind";

import { Secret } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { OptionSelect } from "../../components/option-select.tsx";

import { AppSecretRow, SecretsUnavailable } from "./secret-row.tsx";
import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { fundamentalsSettingsQuery, secretsQuery } from "./settings-query.ts";

/** The FinMind token and the plan it belongs to, which sets how hard Solyx may use it and what it reads. */
export function FinMindSettings() {
  const { t } = useTranslation();
  const secrets = useQuery(secretsQuery());
  const settings = useQuery(fundamentalsSettingsQuery());

  const save = useMutation({
    mutationFn: (plan: FinMindPlan) =>
      window.solyx.settings.setFinMindPlan(plan),
  });

  const failed = secrets.error ?? settings.error;

  if (failed) {
    return (
      <LoadError
        error={failed}
        onRetry={() => {
          void secrets.refetch();
          void settings.refetch();
        }}
      />
    );
  }

  if (!secrets.data || !settings.data) return <LoadingState />;

  const { available, states } = secrets.data;
  const { plan, plans } = settings.data.finMind;
  const selected = plans.find((option) => option.id === plan);
  const planLabel = t("settings.finmind.plan");

  return (
    <div className="flex flex-col gap-3">
      {available ? null : <SecretsUnavailable />}
      <SettingsList>
        <AppSecretRow
          secret={Secret.FinMindToken}
          state={states[Secret.FinMindToken]}
          available={available}
          optional
        />
        <SettingsRow
          label={planLabel}
          description={
            selected
              ? t(
                  selected.memberDatasets
                    ? "settings.finmind.limits.member"
                    : "settings.finmind.limits.free",
                  { requests: selected.requestsPerHour }
                )
              : null
          }
          actions={
            <OptionSelect
              aria-label={planLabel}
              className="w-44"
              value={plan}
              isDisabled={save.isPending}
              options={plans.map((option) => ({
                id: option.id,
                label: t(`settings.finmind.plans.${option.id}`),
              }))}
              onChange={(next) => save.mutate(next)}
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
  );
}
