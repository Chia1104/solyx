import {
  Alert,
  Button,
  Description,
  NumberField,
  Radio,
  RadioGroup,
  Switch,
} from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Currency } from "@solyx/core/market";
import { isEnumValue } from "@solyx/utils/is";

import { TradingBroker } from "#shared/settings.ts";
import type { TradingSettings as Trading } from "#shared/settings.ts";

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

/** The account orders go to, which the desk trades from the app's next start on. */
function BrokerRow({ broker, trading }: Pick<Trading, "broker" | "trading">) {
  const { t } = useTranslation();
  const label = t("settings.trading.broker");
  const save = useMutation(orpc.settings.setTradingBroker.mutationOptions());
  const restart = useMutation(orpc.settings.restart.mutationOptions());

  return (
    <SettingsRow
      label={label}
      description={t("settings.trading.broker-description")}>
      <RadioGroup
        aria-label={label}
        value={broker}
        isDisabled={save.isPending}
        onChange={(next) => {
          if (isEnumValue(TradingBroker, next) && next !== broker) {
            save.mutate(next);
          }
        }}>
        {Object.values(TradingBroker).map((option) => (
          <Radio key={option} value={option}>
            <Radio.Content>
              <Radio.Control>
                <Radio.Indicator />
              </Radio.Control>
              {t(`settings.trading.brokers.${option}`)}
            </Radio.Content>
            <Description>
              {t(`settings.trading.broker-hints.${option}`)}
            </Description>
          </Radio>
        ))}
      </RadioGroup>
      {broker === trading ? null : (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t("settings.trading.restart-title")}</Alert.Title>
            <Alert.Description>
              {t("settings.trading.restart-description", {
                account: t(`settings.trading.brokers.${trading}`),
              })}
            </Alert.Description>
          </Alert.Content>
          <Button
            size="sm"
            variant="secondary"
            isPending={restart.isPending}
            onPress={() => restart.mutate(undefined)}>
            {t("settings.trading.restart")}
          </Button>
        </Alert>
      )}
      {save.error ? (
        <ErrorAlert
          title={t("settings.save-failed")}
          description={save.error.message}
        />
      ) : null}
    </SettingsRow>
  );
}

/** The account orders go to and the limits the desk puts on every order: the user's lock and each currency's daily loss. */
export function TradingSettings() {
  const { t } = useTranslation();
  const { data } = useQuery(tradingSettingsQuery());
  const lock = useMutation(orpc.settings.setOrdersLocked.mutationOptions());

  if (!data) return null;

  return (
    <Section title={t("settings.sections.trading")}>
      <SettingsList>
        <BrokerRow broker={data.broker} trading={data.trading} />
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
