import { useEffect, useRef, useState } from "react";

import {
  Button,
  FieldError,
  Form,
  Label,
  NumberField,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
} from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Controller, useForm, useWatch } from "react-hook-form";
import type { Control } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Market, exchangeDate, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { Depth } from "@solyx/core/market-data";
import { OrderType, Side } from "@solyx/core/order";
import type { OrderRequest } from "@solyx/core/order";
import { ProposalStatus } from "@solyx/core/order-desk";
import { stepTicks, tickSize } from "@solyx/core/risk";
import { TW_BOARD_LOT, twTradeCosts } from "@solyx/core/rules/tw";
import { isEnumValue } from "@solyx/utils/is";

import { orpc } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { Icon } from "../../components/icon.tsx";
import { bandQuery } from "../market/band-query.ts";
import { numberFormats } from "../market/number-formats.ts";

import { ProposalItem } from "./proposal-item.tsx";
import { proposalsQuery } from "./proposals-query.ts";
import {
  TicketUnit,
  useExitTicketSchema,
  useOrderTicketSchema,
} from "./ticket-schema.ts";
import type { ExitTicketValues, OrderTicketValues } from "./ticket-schema.ts";
import { TicketTab, useTicketStore } from "./ticket-store.ts";

const DEFAULT_EXIT_DAYS = 30;

const QUANTITY_PRESETS: Record<TicketUnit, Record<Market, number[]>> = {
  [TicketUnit.Lots]: { [Market.TW]: [1, 2, 5, 10], [Market.US]: [] },
  [TicketUnit.Shares]: { [Market.TW]: [100, 500], [Market.US]: [1, 10, 100] },
};

/**
 * An order or an exit for the listing on the page. Checking it makes a proposal, shown under it
 * to confirm like any other; editing the panel after that dismisses the proposal while it waits.
 */
export function OrderTicket({
  symbol,
  depth,
}: {
  symbol: SymbolRef;
  depth: Depth | null | undefined;
}) {
  const { t } = useTranslation();
  const request = useTicketStore((state) => state.request);
  const [tab, setTab] = useState<TicketTab>(TicketTab.Order);

  // A sale asked for elsewhere opens its tab, whose panel then fills it in.
  useEffect(() => {
    if (request?.key === symbolKey(symbol)) setTab(request.tab);
  }, [request, symbol]);

  return (
    <Tabs
      variant="secondary"
      className="gap-3"
      selectedKey={tab}
      onSelectionChange={(key) => {
        if (isEnumValue(TicketTab, key)) setTab(key);
      }}>
      <Tabs.ListContainer className="border-separator">
        <Tabs.List aria-label={t("order-form.title")}>
          <Tabs.Tab id={TicketTab.Order} className="h-9">
            {t("order-form.tabs.order")}
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab id={TicketTab.Exit} className="h-9">
            {t("order-form.tabs.exit")}
            <Tabs.Indicator />
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>
      <Tabs.Panel id={TicketTab.Order} className="p-0">
        <OrderPanel symbol={symbol} depth={depth} />
      </Tabs.Panel>
      <Tabs.Panel id={TicketTab.Exit} className="p-0">
        <ExitPanel symbol={symbol} />
      </Tabs.Panel>
    </Tabs>
  );
}

/** The proposal the panel made, until the panel is edited. */
function usePanelProposal() {
  const [id, setId] = useState<string | null>(null);

  const propose = useMutation(
    orpc.proposals.propose.mutationOptions({
      onSuccess: (made) => setId(made.id),
    })
  );

  const dismiss = useMutation(orpc.proposals.dismiss.mutationOptions());

  const listed = useQuery({
    ...proposalsQuery(),
    select: (proposals) => proposals.find((proposal) => proposal.id === id),
  });

  // The list hears of a new proposal a moment after `propose` answers with it.
  const proposal =
    id === null
      ? null
      : (listed.data ?? (propose.data?.id === id ? propose.data : null));

  /** Edits mean the proposal no longer says what the user wants, so one still waiting is dismissed. */
  function withdraw() {
    if (proposal?.status === ProposalStatus.AwaitingConfirmation) {
      dismiss.mutate(proposal.id);
    }

    setId(null);
    propose.reset();
  }

  return { proposal, propose, withdraw };
}

/** The shares of `symbol` the account can sell now. */
function useSellable(symbol: SymbolRef): number {
  const { data } = useQuery({
    ...orpc.account.summary.queryOptions(),
    select: (account) =>
      account.positions.find(
        ({ instrument }) => symbolKey(instrument) === symbolKey(symbol)
      ),
  });

  return data ? (data.sellable ?? data.quantity) : 0;
}

function OrderPanel({
  symbol,
  depth,
}: {
  symbol: SymbolRef;
  depth: Depth | null | undefined;
}) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);
  const schema = useOrderTicketSchema();
  const taiwan = symbol.market === Market.TW;
  const { data: band } = useQuery(bandQuery(symbol));
  const sellable = useSellable(symbol);
  const { proposal, propose, withdraw } = usePanelProposal();
  // The price follows the last trade until the user sets one, and stays once checked.
  const [priceSet, setPriceSet] = useState(false);

  const form = useForm({
    resolver: zodResolver(schema),
    // NumberField commits on blur; revalidating then would move the button under the click.
    reValidateMode: "onSubmit",
    defaultValues: {
      side: Side.Buy,
      unit: taiwan ? TicketUnit.Lots : TicketUnit.Shares,
      type: OrderType.Limit,
      price: Number.NaN,
      quantity: 1,
    },
  });

  const { side, unit, type, price, quantity } = useWatch({
    control: form.control,
  });

  const quoted = depth ? (depth.last ?? depth.reference) : null;

  useEffect(() => {
    if (!priceSet && quoted !== null) form.setValue("price", quoted);
  }, [priceSet, quoted, form]);

  function setPrice(next: number) {
    withdraw();
    setPriceSet(true);
    form.setValue("price", next);
    form.clearErrors("price");
  }

  const picked = useTicketStore((state) => state.picked);
  const seenPick = useRef(picked?.count);

  useEffect(() => {
    if (!picked || picked.count === seenPick.current) return;

    seenPick.current = picked.count;

    if (picked.key === symbolKey(symbol)) setPrice(picked.price);
  });

  const request = useTicketStore((state) => state.request);
  const takeRequest = useTicketStore((state) => state.takeRequest);

  // A sale of shares held, asked for from a position: board lots where they make one, else odd shares.
  useEffect(() => {
    if (request?.key !== symbolKey(symbol) || request.tab !== TicketTab.Order) {
      return;
    }

    takeRequest();
    withdraw();

    const lots = taiwan && request.shares >= TW_BOARD_LOT;

    form.setValue("side", Side.Sell);
    form.setValue("unit", lots ? TicketUnit.Lots : TicketUnit.Shares);
    form.setValue(
      "quantity",
      lots ? Math.floor(request.shares / TW_BOARD_LOT) : request.shares
    );
  });

  const marketOrder = type === OrderType.Market;

  const shares =
    quantity === undefined || Number.isNaN(quantity)
      ? null
      : unit === TicketUnit.Lots
        ? quantity * TW_BOARD_LOT
        : quantity;

  // A market order is sized at the session's limit, the furthest it could fill.
  const sizedAt = marketOrder
    ? side === Side.Buy
      ? band?.high
      : band?.low
    : price !== undefined && !Number.isNaN(price)
      ? price
      : undefined;

  const value =
    shares !== null && sizedAt !== undefined ? sizedAt * shares : null;

  const costs =
    value !== null && taiwan && side
      ? twTradeCosts(value, side, symbol.symbol)
      : null;

  const all =
    unit === TicketUnit.Lots
      ? Math.floor(sellable / TW_BOARD_LOT)
      : taiwan
        ? sellable % TW_BOARD_LOT
        : sellable;

  const step = (steps: number) => {
    const from = price !== undefined && !Number.isNaN(price) ? price : quoted;

    if (from !== null && from !== undefined) {
      setPrice(stepTicks(symbol, from, steps));
    }
  };

  const submit = form.handleSubmit((values: OrderTicketValues) => {
    setPriceSet(true);
    propose.mutate({ order: toOrder(symbol, values), rationale: "" });
  });

  const quickPrices = [
    { id: "limit-down", price: band?.low },
    { id: "reference", price: depth?.reference },
    { id: "last", price: depth?.last ?? undefined },
    { id: "limit-up", price: band?.high },
  ] as const;

  return (
    <Form
      validationBehavior="aria"
      className="flex flex-col gap-3"
      onSubmit={(event) => void submit(event)}>
      <Controller
        control={form.control}
        name="side"
        render={({ field }) => (
          <ToggleButtonGroup
            aria-label={t("order-form.side")}
            selectionMode="single"
            disallowEmptySelection
            size="sm"
            className="w-full"
            selectedKeys={[field.value]}
            onSelectionChange={(keys) => {
              const [next] = keys;

              if (isEnumValue(Side, next)) {
                withdraw();
                field.onChange(next);
              }
            }}>
            {Object.values(Side).map((option) => (
              <ToggleButton key={option} id={option} className="flex-1">
                {t(`side.${option}`)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        )}
      />
      <div className="flex gap-2">
        {taiwan ? (
          <Controller
            control={form.control}
            name="unit"
            render={({ field }) => (
              <ToggleButtonGroup
                aria-label={t("order-form.unit")}
                selectionMode="single"
                disallowEmptySelection
                size="sm"
                className="flex-1"
                selectedKeys={[field.value]}
                onSelectionChange={(keys) => {
                  const [next] = keys;

                  if (isEnumValue(TicketUnit, next)) {
                    withdraw();
                    field.onChange(next);
                    form.setValue("quantity", QUANTITY_PRESETS[next].TW[0]);
                  }
                }}>
                {Object.values(TicketUnit).map((option) => (
                  <ToggleButton key={option} id={option} className="flex-1">
                    {t(`order-form.units.${option}`)}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            )}
          />
        ) : null}
        <Controller
          control={form.control}
          name="type"
          render={({ field }) => (
            <ToggleButtonGroup
              aria-label={t("order-form.type")}
              selectionMode="single"
              disallowEmptySelection
              size="sm"
              className="flex-1"
              selectedKeys={[field.value]}
              onSelectionChange={(keys) => {
                const [next] = keys;

                if (isEnumValue(OrderType, next)) {
                  withdraw();
                  field.onChange(next);
                  form.clearErrors("price");
                }
              }}>
              {Object.values(OrderType).map((option) => (
                <ToggleButton key={option} id={option} className="flex-1">
                  {t(`order-type.${option}`)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          )}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-end gap-1">
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            aria-label={t("order-form.tick-down")}
            isDisabled={marketOrder}
            onPress={() => step(-1)}>
            <Icon icon={MinusSignIcon} />
          </Button>
          <Controller
            control={form.control}
            name="price"
            render={({ field, fieldState }) => (
              <NumberField
                className="min-w-0 flex-1"
                isDisabled={marketOrder}
                isInvalid={fieldState.invalid}
                minValue={0}
                // The arrow keys step by the tick at the price shown; the buttons cross the table's bounds exactly.
                step={
                  field.value > 0 ? tickSize(symbol, field.value) : undefined
                }
                formatOptions={{ maximumFractionDigits: 4 }}
                value={field.value}
                onChange={(next) => {
                  withdraw();
                  setPriceSet(true);
                  field.onChange(next ?? Number.NaN);
                }}
                onBlur={field.onBlur}>
                <Label>{t("order-form.price")}</Label>
                <NumberField.Group>
                  <NumberField.Input
                    ref={field.ref}
                    className="text-center tabular-nums"
                  />
                </NumberField.Group>
                <FieldError>{fieldState.error?.message}</FieldError>
              </NumberField>
            )}
          />
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            aria-label={t("order-form.tick-up")}
            isDisabled={marketOrder}
            onPress={() => step(1)}>
            <Icon icon={PlusSignIcon} />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {quickPrices.map((quick) => (
            <Button
              key={quick.id}
              size="sm"
              variant="tertiary"
              className="h-6 min-w-0 px-2 text-xs"
              isDisabled={marketOrder || quick.price === undefined}
              onPress={() => {
                if (quick.price !== undefined) setPrice(quick.price);
              }}>
              {t(`order-form.prices.${quick.id}`)}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Controller
          control={form.control}
          name="quantity"
          render={({ field, fieldState }) => (
            <NumberField
              isInvalid={fieldState.invalid}
              minValue={1}
              step={1}
              value={field.value}
              onChange={(next) => {
                withdraw();
                field.onChange(next ?? Number.NaN);
              }}
              onBlur={field.onBlur}>
              <Label>
                {t(`order-form.quantity.${unit ?? TicketUnit.Shares}`)}
              </Label>
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input
                  ref={field.ref}
                  className="text-center tabular-nums"
                />
                <NumberField.IncrementButton />
              </NumberField.Group>
              <FieldError>{fieldState.error?.message}</FieldError>
            </NumberField>
          )}
        />
        <div className="flex flex-wrap gap-1">
          {QUANTITY_PRESETS[unit ?? TicketUnit.Shares][symbol.market].map(
            (preset) => (
              <Button
                key={preset}
                size="sm"
                variant="tertiary"
                className="h-6 min-w-0 px-2 text-xs tabular-nums"
                onPress={() => {
                  withdraw();
                  form.setValue("quantity", preset);
                  form.clearErrors("quantity");
                }}>
                {format.amount.format(preset)}
              </Button>
            )
          )}
          {side === Side.Sell && all > 0 ? (
            <Button
              size="sm"
              variant="tertiary"
              className="h-6 min-w-0 px-2 text-xs tabular-nums"
              onPress={() => {
                withdraw();
                form.setValue("quantity", all);
                form.clearErrors("quantity");
              }}>
              {t("order-form.all", { count: all })}
            </Button>
          ) : null}
        </div>
      </div>
      {value === null ? null : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs tabular-nums">
          <dt className="text-muted">
            {marketOrder
              ? t(`order-form.costs.value-${side ?? Side.Buy}-market`)
              : t("order-form.costs.value")}
          </dt>
          <dd className="text-right">{format.amount.format(value)}</dd>
          {costs ? (
            <>
              <dt className="text-muted">{t("order-form.costs.commission")}</dt>
              <dd className="text-right">
                {format.amount.format(costs.commission)}
              </dd>
              {side === Side.Sell ? (
                <>
                  <dt className="text-muted">{t("order-form.costs.tax")}</dt>
                  <dd className="text-right">
                    {format.amount.format(costs.tax)}
                  </dd>
                </>
              ) : null}
              <dt className="text-muted">
                {t(`order-form.costs.total-${side ?? Side.Buy}`)}
              </dt>
              <dd className="text-right font-medium">
                {format.amount.format(
                  side === Side.Sell
                    ? value - costs.commission - costs.tax
                    : value + costs.commission
                )}
              </dd>
            </>
          ) : null}
        </dl>
      )}
      <Button
        type="submit"
        variant="secondary"
        className="w-full"
        isPending={propose.isPending}>
        {t("order-form.check")}
      </Button>
      <PanelOutcome
        error={propose.error}
        proposal={proposal}
        hint={t("order-form.hint")}
      />
    </Form>
  );
}

function toOrder(symbol: SymbolRef, values: OrderTicketValues): OrderRequest {
  const order = {
    instrument: symbol,
    side: values.side,
    quantity:
      values.unit === TicketUnit.Lots
        ? values.quantity * TW_BOARD_LOT
        : values.quantity,
  };

  return values.type === OrderType.Limit
    ? { ...order, type: OrderType.Limit, limitPrice: values.price }
    : { ...order, type: OrderType.Market };
}

/** The proposal the panel made, or what to do before there is one. */
function PanelOutcome({
  error,
  proposal,
  hint,
}: {
  error: Error | null;
  proposal: ReturnType<typeof usePanelProposal>["proposal"];
  hint: string;
}) {
  const { t } = useTranslation();

  if (error) {
    return (
      <ErrorAlert
        title={t("proposals.propose-failed")}
        description={error.message}
      />
    );
  }

  if (!proposal) return <p className="text-xs text-muted">{hint}</p>;

  return (
    <div className="-mx-4 border-t border-separator">
      <ProposalItem proposal={proposal} />
      {proposal.status === ProposalStatus.AwaitingConfirmation ? (
        <p className="px-4 pt-2 text-xs text-muted">
          {t("order-form.edit-dismisses")}
        </p>
      ) : null}
    </div>
  );
}

/** A number field the exit panel holds, empty as NaN. */
function ExitNumber({
  control,
  name,
  label,
  description,
  onEdit,
}: {
  control: Control<ExitTicketValues>;
  name: "quantity" | "stop" | "target" | "days";
  label: string;
  description?: string;
  onEdit: () => void;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <NumberField
          isInvalid={fieldState.invalid}
          minValue={0}
          formatOptions={{ maximumFractionDigits: 4 }}
          value={field.value}
          onChange={(next) => {
            onEdit();
            field.onChange(next ?? Number.NaN);
          }}
          onBlur={field.onBlur}>
          <Label>{label}</Label>
          <NumberField.Group>
            <NumberField.Input ref={field.ref} className="tabular-nums" />
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

/** Proposes selling shares held once the price falls to a stop or rises to a target. */
function ExitPanel({ symbol }: { symbol: SymbolRef }) {
  const { t } = useTranslation();
  const schema = useExitTicketSchema();
  const sellable = useSellable(symbol);
  const { proposal, propose, withdraw } = usePanelProposal();

  const form = useForm({
    resolver: zodResolver(schema),
    reValidateMode: "onSubmit",
    defaultValues: {
      quantity: sellable > 0 ? sellable : Number.NaN,
      stop: Number.NaN,
      target: Number.NaN,
      days: DEFAULT_EXIT_DAYS,
    },
  });

  // The account may answer after the panel opens.
  useEffect(() => {
    if (sellable > 0 && !form.getFieldState("quantity").isDirty) {
      form.setValue("quantity", sellable);
    }
  }, [sellable, form]);

  const request = useTicketStore((state) => state.request);
  const takeRequest = useTicketStore((state) => state.takeRequest);

  useEffect(() => {
    if (request?.key !== symbolKey(symbol) || request.tab !== TicketTab.Exit) {
      return;
    }

    takeRequest();
    withdraw();
    form.setValue("quantity", request.shares, { shouldDirty: true });
  });

  const submit = form.handleSubmit((values) => {
    const until = Temporal.PlainDate.from(exchangeDate(symbol.market))
      .add({ days: values.days })
      .toString();

    propose.mutate({
      exit: {
        instrument: symbol,
        quantity: values.quantity,
        stop: Number.isNaN(values.stop) ? null : values.stop,
        target: Number.isNaN(values.target) ? null : values.target,
        until,
      },
      rationale: "",
    });
  });

  return (
    <Form
      validationBehavior="aria"
      className="grid grid-cols-2 gap-3"
      onSubmit={(event) => void submit(event)}>
      <ExitNumber
        control={form.control}
        name="stop"
        label={t("exit-form.stop")}
        onEdit={withdraw}
      />
      <ExitNumber
        control={form.control}
        name="target"
        label={t("exit-form.target")}
        onEdit={withdraw}
      />
      <ExitNumber
        control={form.control}
        name="quantity"
        label={t("exit-form.quantity")}
        onEdit={withdraw}
      />
      <ExitNumber
        control={form.control}
        name="days"
        label={t("exit-form.days")}
        onEdit={withdraw}
      />
      <p className="col-span-full text-xs text-muted">
        {t("exit-form.legs-hint")}
      </p>
      <Button
        type="submit"
        variant="secondary"
        className="col-span-full w-full"
        isPending={propose.isPending}>
        {t("order-form.check")}
      </Button>
      <div className="col-span-full">
        <PanelOutcome
          error={propose.error}
          proposal={proposal}
          hint={t("exit-form.description")}
        />
      </div>
    </Form>
  );
}
