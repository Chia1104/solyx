import { NumberField, Switch } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Currency } from "@solyx/core/market";

import { orpc } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { Section } from "../../components/section.tsx";

import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { tradingSettingsQuery } from "./settings-query.ts";

/** The most a currency's sales may lose in a day, saved as the field commits; empty lifts the limit. */
function LossLimitRow({
  currency,
  amount,
}: {
  currency: Currency;
  amount: number | undefined;
}) {
  const { t } = useTranslation();
  const label = t("settings.trading.max-daily-loss", { currency });
  const save = useMutation(orpc.settings.setMaxDailyLoss.mutationOptions());

  return (
    <SettingsRow
      label={label}
      description={t("settings.trading.max-daily-loss-description")}
      actions={
        <NumberField
          aria-label={label}
          className="w-36"
          minValue={1}
          // Empty number fields hold NaN, which react-aria renders blank.
          value={amount ?? Number.NaN}
          isDisabled={save.isPending}
          onChange={(next) =>
            save.mutate({
              currency,
              amount: Number.isNaN(next) ? null : next,
            })
          }>
          <NumberField.Group>
            <NumberField.Input
              placeholder={t("settings.trading.no-limit")}
              className="text-right tabular-nums"
            />
          </NumberField.Group>
        </NumberField>
      }>
      {save.error ? (
        <ErrorAlert
          title={t("settings.save-failed")}
          description={save.error.message}
        />
      ) : null}
    </SettingsRow>
  );
}

/** The limits the order desk puts on every order: the user's lock and each currency's daily loss. */
export function TradingSettings() {
  const { t } = useTranslation();
  const { data } = useQuery(tradingSettingsQuery());
  const lock = useMutation(orpc.settings.setOrdersLocked.mutationOptions());

  if (!data) return null;

  return (
    <Section title={t("settings.sections.trading")}>
      <SettingsList>
        <SettingsRow
          label={t("proposals.lock.label")}
          description={t("settings.trading.lock-description")}
          actions={
            <Switch
              isSelected={data.locked}
              isDisabled={lock.isPending}
              onChange={(locked) => lock.mutate(locked)}>
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <span className="sr-only">{t("proposals.lock.label")}</span>
              </Switch.Content>
            </Switch>
          }>
          {lock.error ? (
            <ErrorAlert
              title={t("settings.save-failed")}
              description={lock.error.message}
            />
          ) : null}
        </SettingsRow>
        {Object.values(Currency).map((currency) => (
          <LossLimitRow
            key={currency}
            currency={currency}
            amount={data.maxDailyLoss[currency]}
          />
        ))}
      </SettingsList>
    </Section>
  );
}
