import { Description, Label, ListBox, Select } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadingState } from "../../components/loading-state.tsx";

import { providerPlansQuery, settingsQueryKeys } from "./settings-query.ts";

/** The plan held with each market data provider, which sets how hard Solyx may use it. */
export function ProviderPlans() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, error, refetch } = useQuery(providerPlansQuery());

  const save = useMutation({
    mutationFn: (plan: string) =>
      window.solyx.settings.setProviderPlan("fugle", plan),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: settingsQueryKeys.providerPlans,
      }),
  });

  if (error) {
    return (
      <ErrorAlert
        title={t("common.load-failed")}
        description={error.message}
        onRetry={() => void refetch()}
      />
    );
  }

  if (!data) return <LoadingState />;

  const { plan, plans } = data.providers.fugle;
  const selected = plans.find((option) => option.id === plan);

  return (
    <div className="flex flex-col gap-3">
      <Select
        className="max-w-xs"
        value={plan}
        isDisabled={save.isPending}
        onChange={(key) => {
          const next = plans.find((option) => option.id === key);

          if (next && next.id !== plan) save.mutate(next.id);
        }}>
        <Label>{t("settings.providers.fugle.plan")}</Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        {selected ? (
          <Description>
            {t("settings.providers.limits", {
              symbols: selected.streamSymbols,
              intraday: selected.requestsPerMinute.intraday,
              historical: selected.requestsPerMinute.historical,
            })}
          </Description>
        ) : null}
        <Select.Popover>
          <ListBox>
            {plans.map((option) => (
              <ListBox.Item
                key={option.id}
                id={option.id}
                textValue={t(`settings.providers.fugle.plans.${option.id}`)}>
                {t(`settings.providers.fugle.plans.${option.id}`)}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
      <p className="text-sm text-muted">
        {t("settings.providers.edit-file", { file: data.file })}
      </p>
      {save.error ? (
        <ErrorAlert
          title={t("settings.providers.save-failed")}
          description={save.error.message}
        />
      ) : null}
    </div>
  );
}
