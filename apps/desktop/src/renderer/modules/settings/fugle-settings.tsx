import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { FuglePlan } from "@solyx/market-data/fugle";

import { Secret } from "#shared/ipc/settings.ts";
import type { MarketDataStatus } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { OptionSelect } from "../../components/option-select.tsx";

import { PlanLimits } from "./plan-limits.tsx";
import { SecretRow, SecretsUnavailable } from "./secret-row.tsx";
import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { secretsQuery, settingsQueryKeys } from "./settings-query.ts";

/** The Fugle key and the plan it belongs to, which sets how hard Solyx may use it. */
export function FugleSettings({ status }: { status: MarketDataStatus }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const secrets = useQuery(secretsQuery());

  const save = useMutation({
    mutationFn: (plan: FuglePlan) => window.solyx.settings.setFuglePlan(plan),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueryKeys.marketData }),
  });

  if (secrets.error) {
    return (
      <ErrorAlert
        title={t("common.load-failed")}
        description={secrets.error.message}
        onRetry={() => void secrets.refetch()}
      />
    );
  }

  if (!secrets.data) return <LoadingState />;

  const { available, states } = secrets.data;
  const { plan, plans } = status.fugle;
  const selected = plans.find((option) => option.id === plan);
  const planLabel = t("settings.fugle.plan");

  return (
    <div className="flex flex-col gap-3">
      {available ? null : <SecretsUnavailable />}
      <SettingsList>
        <SecretRow
          secret={Secret.FugleApiKey}
          state={states[Secret.FugleApiKey]}
          available={available}
        />
        <SettingsRow
          label={planLabel}
          description={selected ? <PlanLimits plan={selected} /> : null}
          actions={
            <OptionSelect
              aria-label={planLabel}
              className="w-44"
              value={plan}
              isDisabled={save.isPending}
              options={plans.map((option) => ({
                id: option.id,
                label: t(`settings.fugle.plans.${option.id}`),
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
