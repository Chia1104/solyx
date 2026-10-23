import {
  Alert,
  Button,
  Description,
  buttonVariants,
  cn,
  NumberField,
  Radio,
  RadioGroup,
  Switch,
} from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { TradingBroker } from "@solyx/api/settings";
import type {
  TradingAccount,
  TradingSettings as Trading,
} from "@solyx/api/settings";
import { SettingsSection } from "@solyx/api/settings-section";
import { brokerId } from "@solyx/core/broker";
import { Currency } from "@solyx/core/market";

import { orpc } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { Section } from "../../components/section.tsx";

import { MandateSettings } from "./mandate-settings.tsx";
import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { marketDataQuery, tradingSettingsQuery } from "./settings-query.ts";
import { fubonChoices, tradingAccountLabel } from "./trading-account.ts";

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
function BrokerRow({
  broker,
  account,
  trading,
}: Pick<Trading, "broker" | "account" | "trading">) {
  const { t } = useTranslation();
  const label = t("settings.trading.broker");
  const save = useMutation(orpc.settings.setTradingAccount.mutationOptions());
  const restart = useMutation(orpc.settings.restart.mutationOptions());
  const session = useQuery(marketDataQuery()).data?.fubon.session;

  const fubonAccount = broker === TradingBroker.Fubon ? account : null;
  const { accounts: fubonAccounts, gone } = fubonChoices(session, fubonAccount);

  const options: {
    id: string;
    value: TradingAccount;
    label: string;
    hint: string;
  }[] = [
    {
      id: brokerId(TradingBroker.Paper, null),
      value: { broker: TradingBroker.Paper, account: null },
      label: t("settings.trading.brokers.paper"),
      hint: t("settings.trading.broker-hints.paper"),
    },
    ...fubonAccounts.map(({ id, name }) => ({
      id: brokerId(TradingBroker.Fubon, id),
      value: { broker: TradingBroker.Fubon, account: id },
      label: tradingAccountLabel(t, brokerId(TradingBroker.Fubon, id)),
      hint: name,
    })),
  ];

  const picked = brokerId(broker, account);

  return (
    <SettingsRow
      label={label}
      description={t("settings.trading.broker-description")}>
      <RadioGroup
        aria-label={label}
        value={picked}
        isDisabled={save.isPending}
        onChange={(next) => {
          const option = options.find(({ id }) => id === next);

          if (option && next !== picked) save.mutate(option.value);
        }}>
        {options.map((option) => (
          <Radio key={option.id} value={option.id}>
            <Radio.Content>
              <Radio.Control>
                <Radio.Indicator />
              </Radio.Control>
              {option.label}
            </Radio.Content>
            {option.hint ? <Description>{option.hint}</Description> : null}
          </Radio>
        ))}
        {/* Fubon is offered before its sign-in lists an account, so it can be found here. */}
        {fubonAccounts.length > 0 ? null : (
          <Radio value={TradingBroker.Fubon} isDisabled>
            <Radio.Content>
              <Radio.Control>
                <Radio.Indicator />
              </Radio.Control>
              {t("settings.trading.brokers.fubon")}
            </Radio.Content>
            <Description>{t("settings.trading.fubon-sign-in")}</Description>
          </Radio>
        )}
      </RadioGroup>
      {fubonAccounts.length > 0 ? (
        <Description>{t("settings.trading.broker-hints.fubon")}</Description>
      ) : (
        <Link
          to="/settings"
          search={{ section: SettingsSection.Brokers }}
          className={cn(
            buttonVariants({ size: "sm", variant: "secondary" }),
            "self-start"
          )}>
          {t("settings.trading.set-up-fubon")}
        </Link>
      )}
      {gone ? (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>
              {t("settings.trading.account-gone", { account: fubonAccount })}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      {picked === trading ? null : (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t("settings.trading.restart-title")}</Alert.Title>
            <Alert.Description>
              {t("settings.trading.restart-description", {
                account: tradingAccountLabel(t, trading),
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
    <>
      <Section title={t("settings.sections.trading")}>
        <SettingsList>
          <BrokerRow
            broker={data.broker}
            account={data.account}
            trading={data.trading}
          />
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
      <MandateSettings trading={data.trading} />
    </>
  );
}
