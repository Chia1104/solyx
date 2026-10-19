import {
  Button,
  FieldError,
  Form,
  Input,
  Label,
  NumberField,
  TextField,
} from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import type { Control } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Market, exchangeDate } from "@solyx/core/market";
import type { ExitRequest } from "@solyx/core/order";

import { orpc } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { OptionSelect } from "../../components/option-select.tsx";

import { useExitFormSchema } from "./exit-form-schema.ts";
import type { ExitFormValues } from "./exit-form-schema.ts";

const DEFAULT_DAYS = 30;

const priceOrNull = (price: number) => (Number.isNaN(price) ? null : price);

function toExitRequest(values: ExitFormValues): ExitRequest {
  const until = Temporal.PlainDate.from(exchangeDate(values.market))
    .add({ days: values.days })
    .toString();

  return {
    instrument: { market: values.market, symbol: values.symbol },
    quantity: values.quantity,
    stop: priceOrNull(values.stop),
    target: priceOrNull(values.target),
    until,
  };
}

/** A number field the form holds, empty as NaN. */
function NumberRow({
  control,
  name,
  label,
  isRequired = false,
  description,
}: {
  control: Control<ExitFormValues>;
  name: "quantity" | "stop" | "target" | "days";
  label: string;
  isRequired?: boolean;
  description?: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <NumberField
          isRequired={isRequired}
          isInvalid={fieldState.invalid}
          minValue={0}
          formatOptions={{ maximumFractionDigits: 4 }}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}>
          <Label>{label}</Label>
          <NumberField.Group>
            <NumberField.Input ref={field.ref} />
          </NumberField.Group>
          {description ? (
            <p className="text-xs text-muted">{description}</p>
          ) : null}
          <FieldError>{fieldState.error?.message}</FieldError>
        </NumberField>
      )}
    />
  );
}

/** Proposes an exit of shares the account holds: a stop, a target or both, watched for some days. */
export function ExitForm() {
  const { t } = useTranslation();
  const schema = useExitFormSchema();

  const form = useForm({
    resolver: zodResolver(schema),
    // As in the order form: revalidating on blur would move the button under the click.
    reValidateMode: "onSubmit",
    defaultValues: {
      market: Market.TW,
      symbol: "",
      quantity: Number.NaN,
      stop: Number.NaN,
      target: Number.NaN,
      days: DEFAULT_DAYS,
      rationale: "",
    },
  });

  const propose = useMutation(
    orpc.proposals.propose.mutationOptions({ onSuccess: () => form.reset() })
  );

  const submit = form.handleSubmit((values) =>
    propose.mutate({
      exit: toExitRequest(values),
      rationale: values.rationale,
    })
  );

  return (
    <Form
      validationBehavior="aria"
      className="grid grid-cols-2 gap-3"
      onSubmit={(event) => void submit(event)}>
      <Controller
        control={form.control}
        name="market"
        render={({ field, fieldState }) => (
          <OptionSelect
            isRequired
            label={t("order-form.market")}
            value={field.value}
            errorMessage={fieldState.error?.message}
            options={Object.values(Market).map((market) => ({
              id: market,
              label: t(`market.${market}`),
            }))}
            onChange={field.onChange}
          />
        )}
      />
      <Controller
        control={form.control}
        name="symbol"
        render={({ field, fieldState }) => (
          <TextField isRequired isInvalid={fieldState.invalid}>
            <Label>{t("order-form.symbol")}</Label>
            <Input
              {...field}
              placeholder={t("order-form.symbol-placeholder")}
            />
            <FieldError>{fieldState.error?.message}</FieldError>
          </TextField>
        )}
      />
      <NumberRow
        control={form.control}
        name="quantity"
        label={t("order-form.quantity")}
        isRequired
      />
      <NumberRow
        control={form.control}
        name="days"
        label={t("exit-form.days")}
        isRequired
      />
      <NumberRow
        control={form.control}
        name="stop"
        label={t("exit-form.stop")}
        description={t("exit-form.stop-hint")}
      />
      <NumberRow
        control={form.control}
        name="target"
        label={t("exit-form.target")}
        description={t("exit-form.target-hint")}
      />
      <Controller
        control={form.control}
        name="rationale"
        render={({ field }) => (
          <TextField className="col-span-full">
            <Label>{t("order-form.rationale")}</Label>
            <Input
              {...field}
              placeholder={t("order-form.rationale-placeholder")}
            />
          </TextField>
        )}
      />
      <div className="col-span-full flex flex-col gap-2">
        <div>
          <Button
            type="submit"
            variant="secondary"
            isPending={propose.isPending}>
            {t("order-form.submit")}
          </Button>
        </div>
        {propose.error ? (
          <ErrorAlert
            title={t("proposals.propose-failed")}
            description={propose.error.message}
          />
        ) : null}
      </div>
    </Form>
  );
}
