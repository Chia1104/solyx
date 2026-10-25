import { useState } from "react";

import { Button, Checkbox, Switch } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { BacktestMode, MAX_COMPARED } from "@solyx/api/backtests";
import type { BacktestRecord } from "@solyx/api/backtests";
import { symbolKey, symbolLabel } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { useClock } from "../../app/clock.ts";
import { orpc } from "../../app/rpc.ts";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { LowerView } from "../market/lower-view.ts";
import { numberFormats } from "../market/number-formats.ts";

import { useParamWords } from "./backtest-params.ts";
import { useBacktestStore } from "./backtest-store.ts";
import { historyQuery } from "./history-query.ts";

/** A kept run in words: what it ran, over what, and how it did. */
export function useRecordWords() {
  const { t, i18n } = useTranslation();
  const words = useParamWords();
  const format = numberFormats(i18n.language);

  const span = (axis: { param: string; from: number; to: number }) =>
    t("backtests.history.axis", {
      param: words.label(axis.param),
      from: words.value(axis.param, axis.from),
      to: words.value(axis.param, axis.to),
    });

  return {
    title({ request }: BacktestRecord) {
      const { strategy } = request.setup;

      const name =
        "rules" in strategy
          ? t("backtests.form.rules")
          : t(`backtests.templates.${strategy.template}.name`);

      if (
        request.mode === BacktestMode.Scan ||
        request.mode === BacktestMode.WalkForward
      ) {
        return `${name} · ${span(request.setup.rows)} × ${span(request.setup.columns)}`;
      }

      if ("rules" in strategy) return name;

      const numbers = Object.entries({
        ...strategy.params,
        stopLoss: strategy.stopLoss,
        takeProfit: strategy.takeProfit,
      }).flatMap(([param, value]) =>
        value === undefined
          ? []
          : [`${words.label(param)} ${words.value(param, value)}`]
      );

      return [name, ...numbers].join(" · ");
    },

    reach({ request }: BacktestRecord) {
      const { setup } = request;

      const reach = t("backtests.history.reach", {
        mode: t(`backtests.modes.${request.mode}.label`),
        interval: t(`chart.intervals.${setup.interval}`),
        years: t("backtests.form.years-option", { count: setup.years }),
      });

      return request.mode === BacktestMode.Rolling
        ? `${reach} · ${t("backtests.history.windows", {
            months: t("backtests.rolling.months-option", {
              count: request.setup.months,
            }),
          })}`
        : reach;
    },

    headline({ request, headline }: BacktestRecord) {
      if (!headline) return t("backtests.history.no-headline");

      if ("beatHolding" in headline) {
        return t("backtests.history.rolling", {
          share: format.percent.format(headline.beatHolding),
          excess: format.percentChange.format(headline.excess.median),
          count: headline.windows,
        });
      }

      return t(
        request.mode === BacktestMode.Scan
          ? "backtests.history.plateau"
          : "backtests.history.out-of-sample",
        {
          total: format.percentChange.format(headline.totalReturn),
          holding: format.percentChange.format(headline.buyAndHold),
          sharpe:
            headline.sharpe === null
              ? "—"
              : format.indicator.format(headline.sharpe),
          count: headline.trades,
        }
      );
    },
  };
}

function HistoryRow({
  record,
  symbol,
  others,
  picked,
  canPick,
  onPick,
}: {
  record: BacktestRecord;
  symbol: SymbolRef;
  /** Whether rows of other listings show, so a row names its own. */
  others: boolean;
  picked: boolean;
  canPick: boolean;
  onPick: (picked: boolean) => void;
}) {
  const { t } = useTranslation();
  const clock = useClock();
  const recordWords = useRecordWords();
  const navigate = useNavigate();
  const ask = useBacktestStore((state) => state.ask);
  const remove = useMutation(orpc.backtests.remove.mutationOptions());
  const listing = record.request.setup.symbol;

  function open() {
    ask(record.request);

    if (symbolKey(listing) !== symbolKey(symbol)) {
      void navigate({
        to: "/symbol/$market/$symbol",
        params: listing,
        search: {
          interval: record.request.setup.interval,
          view: LowerView.Backtest,
        },
      });
    }
  }

  return (
    <li className="flex items-start gap-3 border-b border-separator py-2">
      {record.request.mode === BacktestMode.Run ? (
        <Checkbox
          aria-label={t("backtests.history.pick")}
          isSelected={picked}
          isDisabled={!picked && !canPick}
          onChange={onPick}
          className="pt-0.5">
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
          </Checkbox.Content>
        </Checkbox>
      ) : (
        <span aria-hidden className="w-4 shrink-0" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm" title={recordWords.title(record)}>
          {recordWords.title(record)}
        </span>
        <span className="text-xs text-muted tabular-nums">
          {others ? `${symbolLabel(listing)} · ` : null}
          {recordWords.reach(record)} · {clock.time(record.ranAt)}
        </span>
        <span className="text-xs tabular-nums">
          {recordWords.headline(record)}
        </span>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button size="sm" variant="tertiary" onPress={open}>
          {t("backtests.history.open")}
        </Button>
        <Button
          size="sm"
          variant="tertiary"
          isPending={remove.isPending}
          onPress={() => remove.mutate(record.id)}>
          {t("backtests.history.remove")}
        </Button>
      </div>
    </li>
  );
}

/** Asks once more before clearing every run kept, since it cannot be undone. */
function ClearHistory() {
  const { t } = useTranslation();
  const [armed, setArmed] = useState(false);
  const clear = useMutation(orpc.backtests.clear.mutationOptions());

  return (
    <Button
      size="sm"
      variant={armed ? "danger-soft" : "tertiary"}
      isPending={clear.isPending}
      onPress={() => {
        if (armed)
          clear.mutate(undefined, { onSettled: () => setArmed(false) });
        else setArmed(true);
      }}>
      {armed
        ? t("backtests.history.clear-confirm")
        : t("backtests.history.clear")}
    </Button>
  );
}

/**
 * The runs windows asked for, newest first: this listing's, or every listing's, each opened in its
 * mode again or removed, and up to `MAX_COMPARED` single runs picked to compare.
 */
export function BacktestHistory({
  symbol,
  picked,
  onPick,
}: {
  symbol: SymbolRef;
  picked: string[];
  onPick: (picked: string[]) => void;
}) {
  const { t } = useTranslation();
  const [everyListing, setEveryListing] = useState(false);
  const { data, error, refetch } = useQuery(historyQuery());

  if (error) return <LoadError error={error} onRetry={() => void refetch()} />;

  if (!data) return <LoadingState />;

  const shown = everyListing
    ? data
    : data.filter(
        ({ request }) => symbolKey(request.setup.symbol) === symbolKey(symbol)
      );

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Switch size="sm" isSelected={everyListing} onChange={setEveryListing}>
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            <span className="text-xs">
              {t("backtests.history.every-listing")}
            </span>
          </Switch.Content>
        </Switch>
        {data.length > 0 ? <ClearHistory /> : null}
      </div>
      <p className="text-xs text-muted">
        {t("backtests.history.pick-hint", { count: MAX_COMPARED })}
      </p>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">{t("backtests.history.empty")}</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((record) => (
            <HistoryRow
              key={record.id}
              record={record}
              symbol={symbol}
              others={everyListing}
              picked={picked.includes(record.id)}
              canPick={picked.length < MAX_COMPARED}
              onPick={(on) =>
                onPick(
                  on
                    ? [...picked, record.id]
                    : picked.filter((id) => id !== record.id)
                )
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}
