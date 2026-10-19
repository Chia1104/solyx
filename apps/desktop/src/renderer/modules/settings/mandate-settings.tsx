import { useMemo, useState } from "react";

import {
  Alert,
  Button,
  Chip,
  Description,
  FieldError,
  Form,
  Input,
  Label,
  NumberField,
  Radio,
  RadioGroup,
  Switch,
  TextField,
} from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import type { Mandate } from "@solyx/core/mandate";
import { Currency, Market } from "@solyx/core/market";
import { Side } from "@solyx/core/order";

import { MAX_MANDATE_DAYS } from "#shared/settings.ts";
import type { MandateDraft, TradingBroker } from "#shared/settings.ts";

import { useClock } from "../../app/clock.ts";
import { orpc } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { Section } from "../../components/section.tsx";
import { numberFormats } from "../market/number-formats.ts";

const Sides = {
  Sales: "sales",
  Both: "both",
} as const;

type Sides = (typeof Sides)[keyof typeof Sides];

const SIDES: Record<Sides, Side[]> = {
  [Sides.Sales]: [Side.Sell],
  [Sides.Both]: [Side.Buy, Side.Sell],
};

const DEFAULT_DAYS = 7;

/** Rebuilt per language so field errors come out localized; the main process checks the draft again. */
function useMandateFormSchema() {
  const { t } = useTranslation();

  return useMemo(() => {
    const required = t("order-form.errors.required");
    const positive = t("order-form.errors.positive");
    const amount = z.number({ error: required }).positive({ error: positive });

    return z.object({
      codes: z
        .string()
        .transform((text) => text.split(/[\s,，、]+/).filter(Boolean))
        .pipe(z.array(z.string()).min(1, { error: required })),
      sides: z.enum(Sides),
      maxOrderValue: amount,
      maxDayValue: amount,
      maxDayOrders: z
        .number({ error: required })
        .int({ error: positive })
        .positive({ error: positive }),
      days: z
        .number({ error: required })
        .int()
        .min(1)
        .max(MAX_MANDATE_DAYS, {
          error: t("mandate.errors.days", { max: MAX_MANDATE_DAYS }),
        }),
      shadow: z.boolean(),
    });
  }, [t]);
}

type MandateFormValues = z.input<ReturnType<typeof useMandateFormSchema>>;

function formValues(mandate: Mandate | null): MandateFormValues {
  return {
    codes: mandate?.listings.map(({ symbol }) => symbol).join(", ") ?? "",
    sides:
      mandate && mandate.sides.includes(Side.Buy) ? Sides.Both : Sides.Sales,
    maxOrderValue: mandate?.maxOrderValue[Currency.TWD] ?? Number.NaN,
    maxDayValue: mandate?.maxDayValue[Currency.TWD] ?? Number.NaN,
    maxDayOrders: mandate?.maxDayOrders ?? Number.NaN,
    days: DEFAULT_DAYS,
    // Shadow unless the user switches it off, so they see what it would send before it sends anything.
    shadow: mandate?.shadow ?? true,
  };
}

/** A whole number of TWD or orders, which an empty field holds as NaN until the schema refuses it. */
function AmountField({
  label,
  value,
  error,
  onChange,
  onBlur,
}: {
  label: string;
  value: number;
  error: string | undefined;
  onChange: (value: number) => void;
  onBlur: () => void;
}) {
  return (
    <NumberField
      isRequired
      isInvalid={error !== undefined}
      minValue={1}
      value={value}
      onChange={onChange}
      onBlur={onBlur}>
      <Label>{label}</Label>
      <NumberField.Group>
        <NumberField.Input className="tabular-nums" />
      </NumberField.Group>
      <FieldError>{error}</FieldError>
    </NumberField>
  );
}

function MandateForm({
  mandate,
  onDone,
}: {
  mandate: Mandate | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const schema = useMandateFormSchema();

  const form = useForm({
    resolver: zodResolver(schema),
    // NumberField commits on blur; revalidating then would shift the buttons under the pointer.
    reValidateMode: "onSubmit",
    defaultValues: formValues(mandate),
  });

  const save = useMutation(
    orpc.settings.setMandate.mutationOptions({ onSuccess: onDone })
  );

  const submit = form.handleSubmit((values) => {
    const draft: MandateDraft = {
      shadow: values.shadow,
      listings: values.codes.map((symbol) => ({
        market: Market.TW,
        symbol: symbol.toUpperCase(),
      })),
      sides: SIDES[values.sides],
      maxOrderValue: { [Currency.TWD]: values.maxOrderValue },
      maxDayValue: { [Currency.TWD]: values.maxDayValue },
      maxDayOrders: values.maxDayOrders,
      days: values.days,
    };

    save.mutate(draft);
  });

  return (
    // Validation runs through the schema, so native browser messages never appear.
    <Form
      validationBehavior="aria"
      className="grid grid-cols-2 gap-3"
      onSubmit={(event) => void submit(event)}>
      <Controller
        control={form.control}
        name="codes"
        render={({ field, fieldState }) => (
          <TextField
            isRequired
            className="col-span-2"
            isInvalid={fieldState.invalid}>
            <Label>{t("mandate.listings")}</Label>
            <Input {...field} placeholder="2330, 0050" />
            <Description>{t("mandate.listings-hint")}</Description>
            <FieldError>{fieldState.error?.message}</FieldError>
          </TextField>
        )}
      />
      <Controller
        control={form.control}
        name="sides"
        render={({ field }) => (
          <RadioGroup
            className="col-span-2"
            orientation="horizontal"
            value={field.value}
            onChange={field.onChange}>
            <Label>{t("mandate.sides")}</Label>
            {Object.values(Sides).map((option) => (
              <Radio key={option} value={option}>
                <Radio.Content>
                  <Radio.Control>
                    <Radio.Indicator />
                  </Radio.Control>
                  {t(`mandate.side-options.${option}`)}
                </Radio.Content>
              </Radio>
            ))}
          </RadioGroup>
        )}
      />
      <Controller
        control={form.control}
        name="maxOrderValue"
        render={({ field, fieldState }) => (
          <AmountField
            label={t("mandate.max-order-value", { currency: Currency.TWD })}
            value={field.value}
            error={fieldState.error?.message}
            onChange={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />
      <Controller
        control={form.control}
        name="maxDayValue"
        render={({ field, fieldState }) => (
          <AmountField
            label={t("mandate.max-day-value", { currency: Currency.TWD })}
            value={field.value}
            error={fieldState.error?.message}
            onChange={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />
      <Controller
        control={form.control}
        name="maxDayOrders"
        render={({ field, fieldState }) => (
          <AmountField
            label={t("mandate.max-day-orders")}
            value={field.value}
            error={fieldState.error?.message}
            onChange={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />
      <Controller
        control={form.control}
        name="days"
        render={({ field, fieldState }) => (
          <AmountField
            label={t("mandate.days", { max: MAX_MANDATE_DAYS })}
            value={field.value}
            error={fieldState.error?.message}
            onChange={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />
      <Controller
        control={form.control}
        name="shadow"
        render={({ field }) => (
          <Switch
            className="col-span-2"
            isSelected={field.value}
            onChange={field.onChange}>
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <span className="flex flex-col">
                <span className="text-sm">{t("mandate.shadow")}</span>
                <span className="text-xs text-muted">
                  {t("mandate.shadow-description")}
                </span>
              </span>
            </Switch.Content>
          </Switch>
        )}
      />
      {save.error ? (
        <div className="col-span-2">
          <ErrorAlert
            title={t("settings.save-failed")}
            description={save.error.message}
          />
        </div>
      ) : null}
      <div className="col-span-2 flex gap-2">
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          isPending={save.isPending}>
          {t("mandate.save")}
        </Button>
        <Button size="sm" variant="tertiary" onPress={onDone}>
          {t("mandate.cancel")}
        </Button>
      </div>
    </Form>
  );
}

/** What the mandate covers, until when, and on which account. */
function MandateSummary({
  mandate,
  trading,
}: {
  mandate: Mandate;
  trading: TradingBroker;
}) {
  const { t, i18n } = useTranslation();
  const clock = useClock();
  const format = numberFormats(i18n.language);
  const expired = mandate.expiresAt <= Date.now();

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {mandate.shadow ? (
          <Chip size="sm">{t("mandate.shadow")}</Chip>
        ) : (
          <Chip size="sm" color="accent">
            {t("mandate.live")}
          </Chip>
        )}
        <span className="text-muted">
          {expired
            ? t("mandate.expired")
            : t("mandate.until", { date: clock.time(mandate.expiresAt) })}
        </span>
      </div>
      <p>
        {t("mandate.covers", {
          listings: mandate.listings.map(({ symbol }) => symbol).join(", "),
          sides: t(
            `mandate.side-options.${mandate.sides.includes(Side.Buy) ? Sides.Both : Sides.Sales}`
          ),
        })}
      </p>
      <p className="text-muted tabular-nums">
        {t("mandate.bounds", {
          order: format.price.format(mandate.maxOrderValue[Currency.TWD] ?? 0),
          day: format.price.format(mandate.maxDayValue[Currency.TWD] ?? 0),
          orders: mandate.maxDayOrders,
          currency: Currency.TWD,
        })}
      </p>
      {mandate.broker === trading ? null : (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>
              {t("mandate.other-account", {
                account: t(`settings.trading.brokers.${mandate.broker}`, {
                  defaultValue: mandate.broker,
                }),
              })}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}
    </div>
  );
}

/** The mandate under which the desk sends the agent's proposals without the user, which only they set. */
export function MandateSettings({ trading }: { trading: TradingBroker }) {
  const { t } = useTranslation();
  const { data: mandate } = useQuery(orpc.settings.mandate.queryOptions());
  const [editing, setEditing] = useState(false);
  const revoke = useMutation(orpc.settings.revokeMandate.mutationOptions());

  if (mandate === undefined) return null;

  return (
    <Section title={t("mandate.title")} description={t("mandate.description")}>
      {editing || mandate === null ? (
        editing ? (
          <MandateForm mandate={mandate} onDone={() => setEditing(false)} />
        ) : (
          <div>
            <Button
              size="sm"
              variant="secondary"
              onPress={() => setEditing(true)}>
              {t("mandate.set")}
            </Button>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-3">
          <MandateSummary mandate={mandate} trading={trading} />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onPress={() => setEditing(true)}>
              {t("mandate.edit")}
            </Button>
            <Button
              size="sm"
              variant="tertiary"
              isPending={revoke.isPending}
              onPress={() => revoke.mutate(undefined)}>
              {t("mandate.revoke")}
            </Button>
          </div>
          {revoke.error ? (
            <ErrorAlert
              title={t("settings.save-failed")}
              description={revoke.error.message}
            />
          ) : null}
        </div>
      )}
    </Section>
  );
}
