import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  Button,
  ButtonGroup,
  FieldError,
  Form,
  Input,
  Label,
  NumberField,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  cn,
} from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMatch } from "@tanstack/react-router";
import { Controller, useForm, useWatch } from "react-hook-form";
import type { Control } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Market, exchangeDate, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { Depth, Listing } from "@solyx/core/market-data";
import { OrderType, Side } from "@solyx/core/order";
import type { OrderRequest } from "@solyx/core/order";
import { ProposalStatus } from "@solyx/core/order-desk";
import { tickSize } from "@solyx/core/risk";
import type { PriceBand } from "@solyx/core/risk";
import { TW_BOARD_LOT, twTradeCosts } from "@solyx/core/rules/tw";
import { isEnumValue } from "@solyx/utils/is";

import { Pane, useLayoutStore } from "../../app/layout-store.ts";
import { orpc } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { sellableOf } from "../account/positions-table.tsx";
import { AgentTab, useAgentStore } from "../agent/agent-store.ts";
import { bandQuery } from "../market/band-query.ts";
import { listingName, useListingName } from "../market/listing-name.tsx";
import { listingQuery } from "../market/listing-query.ts";
import { numberFormats } from "../market/number-formats.ts";
import { useDirectionColors } from "../market/price-colors.ts";
import { directionOf } from "../market/quote-figures.tsx";
import { useDepth } from "../market/use-depth.ts";
import { useMarketSources } from "../settings/settings-query.ts";

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
 * The order panel: a listing, then an order or an exit of it written out as a draft in pencil.
 * Checking the draft proposes it, and the proposal waits under it as in the queue. On a listing's
 * page it trades that listing, which the page already names and quotes; elsewhere the user types
 * one.
 */
export function OrderTicket() {
  const { t } = useTranslation();
  const held = useTicketStore((state) => state.symbol);
  const tabShown = useAgentStore((state) => state.tab === AgentTab.Ticket);
  const paneOpen = useLayoutStore((state) => state.panes[Pane.Agent].open);

  const page = useMatch({
    from: "/symbol/$market/$symbol",
    shouldThrow: false,
  });

  const symbol = page?.params ?? held;

  return (
    <section
      aria-label={t("order-form.title")}
      className="flex flex-col gap-4 p-4">
      {page ? null : <SymbolInput symbol={symbol} />}
      {symbol ? (
        <ListingTicket
          key={symbolKey(symbol)}
          symbol={symbol}
          quoted={!page}
          inView={tabShown && paneOpen}
        />
      ) : (
        <p className="text-sm text-muted">{t("order-form.no-listing")}</p>
      )}
    </section>
  );
}

/** The listing the panel trades, typed as its code and market; it takes the code on blur or Enter. */
function SymbolInput({ symbol }: { symbol: SymbolRef | null }) {
  const { t } = useTranslation();
  const setSymbol = useTicketStore((state) => state.setSymbol);
  const [market, setMarket] = useState<Market>(symbol?.market ?? Market.TW);
  const [code, setCode] = useState(symbol?.symbol ?? "");

  // A sale may name another listing while the field shows this one.
  useEffect(() => {
    if (!symbol) return;

    setMarket(symbol.market);
    setCode(symbol.symbol);
  }, [symbol]);

  const commit = (nextMarket = market) => {
    const typed = code.trim().toUpperCase();

    if (typed) setSymbol({ market: nextMarket, symbol: typed });
  };

  return (
    <div className="flex items-end gap-2">
      <TextField className="min-w-0 flex-1">
        <Label>{t("order-form.symbol")}</Label>
        <Input
          value={code}
          placeholder={t("order-form.symbol-placeholder")}
          className="uppercase"
          onChange={(event) => setCode(event.target.value)}
          onBlur={() => commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
        />
      </TextField>
      <ToggleButtonGroup
        aria-label={t("order-form.market")}
        selectionMode="single"
        disallowEmptySelection
        size="sm"
        className="shrink-0"
        selectedKeys={[market]}
        onSelectionChange={(keys) => {
          const [next] = keys;

          if (isEnumValue(Market, next)) {
            setMarket(next);
            commit(next);
          }
        }}>
        {Object.values(Market).map((option) => (
          <ToggleButton key={option} id={option}>
            {t(`market.${option}`)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </div>
  );
}

/**
 * The panel's tabs for one listing. They open only once the market's source lists it, so a code
 * mistyped or a market without a source proposes nothing; `quoted` adds its name and last price.
 * It stays mounted behind the pane's other tabs, so it follows the book only while `inView`.
 */
function ListingTicket({
  symbol,
  quoted,
  inView,
}: {
  symbol: SymbolRef;
  quoted: boolean;
  inView: boolean;
}) {
  const { t } = useTranslation();
  const tab = useTicketStore((state) => state.tab);
  const setTab = useTicketStore((state) => state.setTab);
  const sources = useMarketSources();
  const ready = sources.data?.[symbol.market]?.ready === true;
  const lookup = useQuery({ ...listingQuery(symbol), enabled: ready });
  const listing = lookup.data ?? null;
  const depth = useDepth(listing && inView ? symbol : null);
  const market = t(`market.${symbol.market}`);

  return (
    <>
      {sources.data && !ready ? (
        <p className="text-sm text-muted">
          {t("order-form.no-source", { market })}
        </p>
      ) : null}
      {lookup.error ? (
        <LoadError error={lookup.error} onRetry={() => void lookup.refetch()} />
      ) : null}
      {lookup.data === null ? (
        <p role="alert" className="text-sm text-danger">
          {t("order-form.not-found", { market, symbol: symbol.symbol })}
        </p>
      ) : null}
      {quoted && listing ? (
        <ListingQuote symbol={symbol} listing={listing} depth={depth} />
      ) : null}
      <div
        inert={!listing}
        className={cn(
          "flex flex-col gap-4 transition-opacity",
          !listing && "opacity-50"
        )}>
        {/* A mode of the one panel rather than tabs, which the pane's own already are. */}
        <ToggleButtonGroup
          aria-label={t("order-form.title")}
          selectionMode="single"
          disallowEmptySelection
          size="sm"
          fullWidth
          selectedKeys={[tab]}
          onSelectionChange={(keys) => {
            const [next] = keys;

            if (isEnumValue(TicketTab, next)) setTab(next);
          }}>
          {Object.values(TicketTab).map((option, index) => (
            <ToggleButton key={option} id={option} className="flex-1">
              {index > 0 ? <ToggleButtonGroup.Separator /> : null}
              {t(`order-form.tabs.${option}`)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {/* Both stay mounted, so moving between them keeps each one's draft. */}
        <div hidden={tab !== TicketTab.Order}>
          <OrderPanel symbol={symbol} depth={depth} />
        </div>
        <div hidden={tab !== TicketTab.Exit}>
          <ExitPanel symbol={symbol} />
        </div>
      </div>
    </>
  );
}

/** The listing's name with its last price against its reference, once the book has one. */
function ListingQuote({
  symbol,
  listing,
  depth,
}: {
  symbol: SymbolRef;
  listing: Listing;
  depth: Depth | null | undefined;
}) {
  const { i18n } = useTranslation();
  const direction = useDirectionColors(symbol.market);
  const format = numberFormats(i18n.language);
  const last = depth?.last ?? null;

  return (
    <p className="flex min-w-0 items-baseline gap-2">
      <span className="min-w-0 truncate text-sm font-medium">
        {listingName(listing, i18n.language)}
      </span>
      {last === null || !depth ? null : (
        <>
          <span className="ml-auto shrink-0 text-sm font-semibold tabular-nums">
            {format.quotePrice.format(last)}
          </span>
          <span
            className={cn(
              "shrink-0 text-xs tabular-nums",
              directionOf(direction, last - depth.reference)?.text ??
                "text-muted"
            )}>
            {format.quotePercentChange.format(
              (last - depth.reference) / depth.reference
            )}
          </span>
        </>
      )}
    </p>
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
    select: (account) => {
      const position = account.positions.find(
        ({ instrument }) => symbolKey(instrument) === symbolKey(symbol)
      );

      return position ? sellableOf(position) : 0;
    },
  });

  return data ?? 0;
}

/** A number the panel holds, empty as NaN, stepped by `step` from either end of the field. */
function StepField({
  label,
  value,
  step,
  isDisabled,
  invalid,
  onChange,
  onBlur,
  inputRef,
}: {
  label: string;
  value: number | undefined;
  step: number;
  isDisabled?: boolean;
  invalid?: string;
  onChange: (value: number) => void;
  onBlur: () => void;
  inputRef: (element: HTMLInputElement | null) => void;
}) {
  return (
    <NumberField
      isDisabled={isDisabled}
      isInvalid={invalid !== undefined}
      minValue={0}
      step={step}
      formatOptions={{ maximumFractionDigits: 4 }}
      value={value}
      onChange={(next) => onChange(next ?? Number.NaN)}
      onBlur={onBlur}>
      <Label>{label}</Label>
      <NumberField.Group>
        <NumberField.DecrementButton />
        <NumberField.Input
          ref={inputRef}
          className="text-center tabular-nums"
        />
        <NumberField.IncrementButton />
      </NumberField.Group>
      <FieldError>{invalid}</FieldError>
    </NumberField>
  );
}

/** Quick picks under a field, one row of the same buttons. */
function Picks({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ButtonGroup
      aria-label={label}
      size="sm"
      variant="tertiary"
      className="w-full [&>*]:min-w-0 [&>*]:flex-1 [&>*]:tabular-nums">
      {children}
    </ButtonGroup>
  );
}

/** The order as written so far, in pencil: it is a draft until checking makes it a proposal. */
function Draft({
  sentence,
  children,
}: {
  sentence: string;
  children?: ReactNode;
}) {
  return (
    <div className="relative flex flex-col gap-2 border border-dashed border-border py-2.5 pr-3 pl-5">
      <span aria-hidden className="absolute inset-y-2.5 left-2 w-1.5 hatch" />
      <p className="text-sm font-medium tabular-nums">{sentence}</p>
      {children}
    </div>
  );
}

/** One of an enum's values, as a row of toggles. */
function EnumToggle<T extends string>({
  options,
  value,
  label,
  labelOf,
  className,
  onChange,
}: {
  options: readonly T[];
  value: T;
  label: string;
  labelOf: (option: T) => string;
  className: string;
  onChange: (option: T) => void;
}) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      size="sm"
      className={className}
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const [key] = keys;
        const next = options.find((option) => option === key);

        if (next !== undefined) onChange(next);
      }}>
      {options.map((option) => (
        <ToggleButton key={option} id={option} className="flex-1">
          {labelOf(option)}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

/** Calls `take` with each price picked elsewhere on the page for `symbol`, such as from the book. */
function usePickedPrice(symbol: SymbolRef, take: (price: number) => void) {
  const picked = useTicketStore((state) => state.picked);
  const seenPick = useRef(picked?.count);

  useEffect(() => {
    if (!picked || picked.count === seenPick.current) return;

    seenPick.current = picked.count;

    if (picked.key === symbolKey(symbol)) take(picked.price);
  });
}

/** Calls `take` with the shares of a sale of `symbol` asked for elsewhere in `tab`, such as from a position. */
function useTicketRequest(
  symbol: SymbolRef,
  tab: TicketTab,
  take: (shares: number) => void
) {
  const request = useTicketStore((state) => state.request);
  const takeRequest = useTicketStore((state) => state.takeRequest);

  useEffect(() => {
    if (request?.key !== symbolKey(symbol) || request.tab !== tab) return;

    takeRequest();
    take(request.shares);
  });
}

/** The shares `quantity` makes in `unit`. */
function sharesIn(unit: TicketUnit | undefined, quantity: number) {
  return unit === TicketUnit.Lots ? quantity * TW_BOARD_LOT : quantity;
}

/** How many of `sellable` shares a sale in `unit` can take: whole board lots, or the odd shares a Taiwan account has left over. */
function sellableIn(
  unit: TicketUnit | undefined,
  sellable: number,
  taiwan: boolean
) {
  if (unit === TicketUnit.Lots) return Math.floor(sellable / TW_BOARD_LOT);

  return taiwan ? sellable % TW_BOARD_LOT : sellable;
}

/**
 * What the draft comes to: its price where one is set, its value at that price or, for a market
 * order, at the session's limit it could fill furthest at, a Taiwan trade's costs, and how many
 * the account could sell in the unit.
 */
function orderFigures(
  { side, unit, type, price, quantity }: Partial<OrderTicketValues>,
  band: PriceBand | null | undefined,
  sellable: number,
  symbol: SymbolRef
) {
  const taiwan = symbol.market === Market.TW;
  const marketOrder = type === OrderType.Market;

  const priced =
    price !== undefined && !Number.isNaN(price) && price > 0 ? price : null;

  const shares =
    quantity === undefined || Number.isNaN(quantity)
      ? null
      : sharesIn(unit, quantity);

  // A market order is sized at the session's limit, the furthest it could fill.
  const sizedAt = marketOrder
    ? side === Side.Buy
      ? band?.high
      : band?.low
    : (priced ?? undefined);

  const value =
    shares !== null && sizedAt !== undefined ? sizedAt * shares : null;

  return {
    marketOrder,
    priced,
    value,
    costs:
      value !== null && taiwan && side
        ? twTradeCosts(value, side, symbol.symbol)
        : null,
    all: sellableIn(unit, sellable, taiwan),
    // Board lots and odd shares sell as separate orders, so a sale in lots leaves the odd ones.
    oddLeft:
      side === Side.Sell && unit === TicketUnit.Lots
        ? sellable % TW_BOARD_LOT
        : 0,
  };
}

/** The session's limits, the reference and the last trade, to set the price to in one press. */
function PricePicks({
  band,
  depth,
  isDisabled,
  onPick,
}: {
  band: PriceBand | null | undefined;
  depth: Depth | null | undefined;
  isDisabled: boolean;
  onPick: (price: number) => void;
}) {
  const { t } = useTranslation();

  const quickPrices = [
    { id: "limit-down", price: band?.low },
    { id: "reference", price: depth?.reference },
    { id: "last", price: depth?.last ?? undefined },
    { id: "limit-up", price: band?.high },
  ] as const;

  return (
    <Picks label={t("order-form.price")}>
      {quickPrices.map((quick) => (
        <Button
          key={quick.id}
          isDisabled={isDisabled || quick.price === undefined}
          onPress={() => {
            if (quick.price !== undefined) onPick(quick.price);
          }}>
          {t(`order-form.prices.${quick.id}`)}
        </Button>
      ))}
    </Picks>
  );
}

/** Sizes to set the quantity to in one press, and on a sale every one the account can sell. */
function QuantityPicks({
  market,
  unit,
  all,
  onPick,
}: {
  market: Market;
  unit: TicketUnit;
  /** How many the account can sell in `unit`; `null` where the draft buys. */
  all: number | null;
  onPick: (quantity: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  return (
    <Picks label={t(`order-form.quantity.${unit}`)}>
      {QUANTITY_PRESETS[unit][market].map((preset) => (
        <Button key={preset} onPress={() => onPick(preset)}>
          {format.amount.format(preset)}
        </Button>
      ))}
      {all !== null && all > 0 ? (
        <Button onPress={() => onPick(all)}>
          {t("order-form.all", { count: all })}
        </Button>
      ) : null}
    </Picks>
  );
}

/** What the draft would cost or bring in: its value and, for a Taiwan trade, commission, tax and the total. */
function OrderCosts({
  value,
  costs,
  side,
  marketOrder,
}: {
  value: number;
  costs: ReturnType<typeof twTradeCosts> | null;
  side: Side;
  marketOrder: boolean;
}) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs tabular-nums">
      <dt className="text-muted">
        {marketOrder
          ? t(`order-form.costs.value-${side}-market`)
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
              <dd className="text-right">{format.amount.format(costs.tax)}</dd>
            </>
          ) : null}
          <dt className="font-medium">{t(`order-form.costs.total-${side}`)}</dt>
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
  );
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
  const name = useListingName(symbol) ?? symbol.symbol;
  const { data: band } = useQuery(bandQuery(symbol));
  const sellable = useSellable(symbol);
  const { proposal, propose, withdraw } = usePanelProposal();
  // The price follows the last trade until the user sets one, and stays once checked.
  const priceSet = useRef(false);

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

  const values = useWatch({ control: form.control });
  const side = values.side ?? Side.Buy;
  const unit = values.unit ?? TicketUnit.Shares;
  const quoted = depth ? (depth.last ?? depth.reference) : null;

  useEffect(() => {
    if (!priceSet.current && quoted !== null) form.setValue("price", quoted);
  }, [quoted, form]);

  function setPrice(next: number) {
    withdraw();
    priceSet.current = true;
    form.setValue("price", next);
    form.clearErrors("price");
  }

  function setQuantity(next: number) {
    withdraw();
    form.setValue("quantity", next);
    form.clearErrors("quantity");
  }

  usePickedPrice(symbol, setPrice);

  // A sale of shares held, asked for from a position, replaces the draft: a limit at the last price
  // that the price follows again, in board lots where they make one, else odd shares.
  useTicketRequest(symbol, TicketTab.Order, (shares) => {
    withdraw();
    priceSet.current = false;

    const lots = taiwan && shares >= TW_BOARD_LOT;

    form.reset({
      side: Side.Sell,
      unit: lots ? TicketUnit.Lots : TicketUnit.Shares,
      type: OrderType.Limit,
      price: quoted ?? Number.NaN,
      quantity: lots ? Math.floor(shares / TW_BOARD_LOT) : shares,
    });
  });

  const { marketOrder, priced, value, costs, all, oddLeft } = orderFigures(
    values,
    band,
    sellable,
    symbol
  );

  const submit = form.handleSubmit((submitted: OrderTicketValues) => {
    priceSet.current = true;
    propose.mutate({ order: toOrder(symbol, submitted), rationale: "" });
  });

  const { quantity } = values;

  const sentence = t(
    marketOrder ? "order-form.draft-market" : "order-form.draft",
    {
      side: t(`side.${side}`),
      quantity:
        quantity === undefined || Number.isNaN(quantity)
          ? "–"
          : t(`order-form.count.${unit}`, { count: quantity }),
      name,
      price: priced === null ? "–" : format.quotePrice.format(priced),
    }
  );

  return (
    <Form
      validationBehavior="aria"
      className="flex flex-col gap-4"
      onSubmit={(event) => void submit(event)}>
      <div className="flex flex-wrap gap-2">
        <Controller
          control={form.control}
          name="side"
          render={({ field }) => (
            <EnumToggle
              label={t("order-form.side")}
              options={Object.values(Side)}
              value={field.value}
              labelOf={(option) => t(`side.${option}`)}
              className="min-w-0 flex-[2]"
              onChange={(next) => {
                withdraw();
                field.onChange(next);
              }}
            />
          )}
        />
        <Controller
          control={form.control}
          name="type"
          render={({ field }) => (
            <EnumToggle
              label={t("order-form.type")}
              options={Object.values(OrderType)}
              value={field.value}
              labelOf={(option) => t(`order-type.${option}`)}
              className="min-w-0 flex-1"
              onChange={(next) => {
                withdraw();
                field.onChange(next);
                form.clearErrors("price");
              }}
            />
          )}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Controller
          control={form.control}
          name="price"
          render={({ field, fieldState }) => (
            <StepField
              label={t("order-form.price")}
              value={field.value}
              // Each step is the tick at the price shown, so every price it lands on is one the exchange takes.
              step={tickSize(symbol, priced ?? quoted ?? 1)}
              isDisabled={marketOrder}
              invalid={fieldState.error?.message}
              onChange={(next) => {
                withdraw();
                priceSet.current = true;
                field.onChange(next);
              }}
              onBlur={field.onBlur}
              inputRef={field.ref}
            />
          )}
        />
        <PricePicks
          band={band}
          depth={depth}
          isDisabled={marketOrder}
          onPick={setPrice}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        {taiwan ? (
          <Controller
            control={form.control}
            name="unit"
            render={({ field }) => (
              <EnumToggle
                label={t("order-form.unit")}
                options={Object.values(TicketUnit)}
                value={field.value}
                labelOf={(option) => t(`order-form.units.${option}`)}
                className="w-full"
                onChange={(next) => {
                  withdraw();
                  field.onChange(next);
                  form.setValue("quantity", QUANTITY_PRESETS[next].TW[0]);
                }}
              />
            )}
          />
        ) : null}
        <Controller
          control={form.control}
          name="quantity"
          render={({ field, fieldState }) => (
            <StepField
              label={t(`order-form.quantity.${unit}`)}
              value={field.value}
              step={1}
              invalid={fieldState.error?.message}
              onChange={(next) => {
                withdraw();
                field.onChange(next);
              }}
              onBlur={field.onBlur}
              inputRef={field.ref}
            />
          )}
        />
        <QuantityPicks
          market={symbol.market}
          unit={unit}
          all={side === Side.Sell ? all : null}
          onPick={setQuantity}
        />
      </div>
      <Draft sentence={sentence}>
        {value === null ? null : (
          <OrderCosts
            value={value}
            costs={costs}
            side={side}
            marketOrder={marketOrder}
          />
        )}
        {oddLeft > 0 ? (
          <p className="text-xs text-muted">
            {t("order-form.odd-left", { count: oddLeft })}
          </p>
        ) : null}
      </Draft>
      <Button
        type="submit"
        variant="secondary"
        className="w-full"
        isPending={propose.isPending}>
        {t("order-form.check")}
      </Button>
      <Outcome error={propose.error} proposal={proposal} />
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

/**
 * What came of checking the draft: the proposal it made, confirmed or dismissed right here as in
 * the queue, or why none was made.
 */
function Outcome({
  error,
  proposal,
}: {
  error: Error | null;
  proposal: ReturnType<typeof usePanelProposal>["proposal"];
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

  if (!proposal) {
    return <p className="text-xs text-muted">{t("order-form.hint")}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {proposal.status === ProposalStatus.AwaitingConfirmation ? (
        <p className="text-xs text-muted">{t("order-form.waiting")}</p>
      ) : null}
      <div className="-mx-4 border-t border-separator">
        <ProposalItem proposal={proposal} />
      </div>
    </div>
  );
}

/** A number the exit panel holds, empty as NaN. */
function ExitNumber({
  control,
  name,
  label,
  step,
  onEdit,
}: {
  control: Control<ExitTicketValues>;
  name: "quantity" | "stop" | "target" | "days";
  label: string;
  step: number;
  onEdit: () => void;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <StepField
          label={label}
          value={field.value}
          step={step}
          invalid={fieldState.error?.message}
          onChange={(next) => {
            onEdit();
            field.onChange(next);
          }}
          onBlur={field.onBlur}
          inputRef={field.ref}
        />
      )}
    />
  );
}

/** Proposes selling shares held once the price falls to a stop or rises to a target. */
function ExitPanel({ symbol }: { symbol: SymbolRef }) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);
  const schema = useExitTicketSchema();
  const name = useListingName(symbol) ?? symbol.symbol;
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

  const { quantity, stop, target, days } = useWatch({ control: form.control });

  // The account may answer after the panel opens.
  useEffect(() => {
    if (sellable > 0 && !form.getFieldState("quantity").isDirty) {
      form.setValue("quantity", sellable);
    }
  }, [sellable, form]);

  useTicketRequest(symbol, TicketTab.Exit, (shares) => {
    withdraw();
    form.setValue("quantity", shares, { shouldDirty: true });
    form.clearErrors("quantity");
  });

  const submit = form.handleSubmit((values) => {
    propose.mutate({
      exit: {
        instrument: symbol,
        quantity: values.quantity,
        stop: Number.isNaN(values.stop) ? null : values.stop,
        target: Number.isNaN(values.target) ? null : values.target,
        until: Temporal.PlainDate.from(exchangeDate(symbol.market))
          .add({ days: values.days })
          .toString(),
      },
      rationale: "",
    });
  });

  const priceOf = (value: number | undefined) =>
    value === undefined || Number.isNaN(value)
      ? "–"
      : format.quotePrice.format(value);

  const priceStep = (value: number | undefined) =>
    tickSize(symbol, value !== undefined && value > 0 ? value : 1);

  return (
    <Form
      validationBehavior="aria"
      className="flex flex-col gap-4"
      onSubmit={(event) => void submit(event)}>
      <div className="grid grid-cols-2 gap-3">
        <ExitNumber
          control={form.control}
          name="stop"
          label={t("exit-form.stop")}
          step={priceStep(stop)}
          onEdit={withdraw}
        />
        <ExitNumber
          control={form.control}
          name="target"
          label={t("exit-form.target")}
          step={priceStep(target)}
          onEdit={withdraw}
        />
        <ExitNumber
          control={form.control}
          name="quantity"
          label={t("exit-form.quantity")}
          step={1}
          onEdit={withdraw}
        />
        <ExitNumber
          control={form.control}
          name="days"
          label={t("exit-form.days")}
          step={1}
          onEdit={withdraw}
        />
      </div>
      <Draft
        sentence={t("exit-form.draft", {
          quantity:
            quantity === undefined || Number.isNaN(quantity)
              ? "–"
              : format.amount.format(quantity),
          name,
          stop: priceOf(stop),
          target: priceOf(target),
          days: days === undefined || Number.isNaN(days) ? "–" : days,
        })}>
        <p className="text-xs text-muted">{t("exit-form.legs-hint")}</p>
      </Draft>
      <Button
        type="submit"
        variant="secondary"
        className="w-full"
        isPending={propose.isPending}>
        {t("order-form.check")}
      </Button>
      <Outcome error={propose.error} proposal={proposal} />
    </Form>
  );
}
