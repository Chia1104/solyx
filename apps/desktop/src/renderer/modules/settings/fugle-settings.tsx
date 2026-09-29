import { Description, Label, ListBox, Select } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { FuglePlan } from "@solyx/market-data/fugle";

import { Secret } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadingState } from "../../components/loading-state.tsx";

import { PlanLimits } from "./plan-limits.tsx";
import { SecretFields } from "./secret-fields.tsx";
import { marketDataQuery, settingsQueryKeys } from "./settings-query.ts";

/** The Fugle key and the plan it belongs to, which sets how hard Solyx may use it. */
export function FugleSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, error, refetch } = useQuery(marketDataQuery());

  const save = useMutation({
    mutationFn: (plan: FuglePlan) => window.solyx.settings.setFuglePlan(plan),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueryKeys.marketData }),
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

  const { plan, plans } = data.fugle;
  const selected = plans.find((option) => option.id === plan);

  return (
    <div className="flex flex-col gap-6">
      <SecretFields secrets={[Secret.FugleApiKey]} />
      <Select
        className="max-w-xs"
        value={plan}
        isDisabled={save.isPending}
        onChange={(key) => {
          const next = plans.find((option) => option.id === key);

          if (next && next.id !== plan) save.mutate(next.id);
        }}>
        <Label>{t("settings.fugle.plan")}</Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        {selected ? (
          <Description>
            <PlanLimits plan={selected} />
          </Description>
        ) : null}
        <Select.Popover>
          <ListBox>
            {plans.map((option) => (
              <ListBox.Item
                key={option.id}
                id={option.id}
                textValue={t(`settings.fugle.plans.${option.id}`)}>
                {t(`settings.fugle.plans.${option.id}`)}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
      {save.error ? (
        <ErrorAlert
          title={t("settings.market-data.save-failed")}
          description={save.error.message}
        />
      ) : null}
    </div>
  );
}
