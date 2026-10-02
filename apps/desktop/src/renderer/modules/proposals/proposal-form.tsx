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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { InstrumentKind, Market } from "@solyx/core/market";
import { OrderType, Side } from "@solyx/core/order";
import type { OrderRequest } from "@solyx/core/order";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { OptionSelect } from "../../components/option-select.tsx";

import { useOrderFormSchema } from "./order-form-schema.ts";
import type { OrderFormValues } from "./order-form-schema.ts";
import { proposalsQueryKeys } from "./proposals-query.ts";

function toOrderRequest(values: OrderFormValues): OrderRequest {
  return {
    instrument: {
      market: values.market,
      symbol: values.symbol,
      kind: values.kind,
    },
    side: values.side,
    quantity: values.quantity,
    type: OrderType.Limit,
    limitPrice: values.limitPrice,
  };
}

export function ProposalForm() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const schema = useOrderFormSchema();

  // Empty number fields hold NaN, which react-aria renders blank and the schema rejects.
  const form = useForm({
    resolver: zodResolver(schema),
    // NumberField commits on blur; revalidating then would drop error text and shift the
    // submit button between mousedown and mouseup, swallowing the click.
    reValidateMode: "onSubmit",
    defaultValues: {
      market: Market.TW,
      kind: InstrumentKind.Stock,
      side: Side.Buy,
      symbol: "",
      quantity: Number.NaN,
      limitPrice: Number.NaN,
      rationale: "",
    },
  });

  const propose = useMutation({
    mutationFn: (values: OrderFormValues) =>
      window.solyx.proposals.propose(toOrderRequest(values), values.rationale),
    onSuccess: () => form.reset(),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: proposalsQueryKeys.all }),
  });

  const submit = form.handleSubmit((values) => propose.mutate(values));

  return (
    // Validation runs through the schema, so native browser messages never appear.
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
        name="kind"
        render={({ field, fieldState }) => (
          <OptionSelect
            isRequired
            label={t("order-form.kind")}
            value={field.value}
            errorMessage={fieldState.error?.message}
            options={Object.values(InstrumentKind).map((kind) => ({
              id: kind,
              label: t(`kind.${kind}`),
            }))}
            onChange={field.onChange}
          />
        )}
      />
      <Controller
        control={form.control}
        name="side"
        render={({ field, fieldState }) => (
          <OptionSelect
            isRequired
            label={t("order-form.side")}
            value={field.value}
            errorMessage={fieldState.error?.message}
            options={Object.values(Side).map((side) => ({
              id: side,
              label: t(`side.${side}`),
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
      <Controller
        control={form.control}
        name="quantity"
        render={({ field, fieldState }) => (
          <NumberField
            isRequired
            isInvalid={fieldState.invalid}
            minValue={1}
            step={1}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}>
            <Label>{t("order-form.quantity")}</Label>
            <NumberField.Group>
              <NumberField.Input ref={field.ref} />
            </NumberField.Group>
            <FieldError>{fieldState.error?.message}</FieldError>
          </NumberField>
        )}
      />
      <Controller
        control={form.control}
        name="limitPrice"
        render={({ field, fieldState }) => (
          <NumberField
            isRequired
            isInvalid={fieldState.invalid}
            minValue={0}
            formatOptions={{ maximumFractionDigits: 4 }}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}>
            <Label>{t("order-form.limit-price")}</Label>
            <NumberField.Group>
              <NumberField.Input ref={field.ref} />
            </NumberField.Group>
            <FieldError>{fieldState.error?.message}</FieldError>
          </NumberField>
        )}
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
