import { useQueries, useQuery } from "@tanstack/react-query";
import { sumBy } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { inTwd } from "@solyx/core/exchange-rate";
import { Currency, currencyOf } from "@solyx/core/market";
import { positionValue } from "@solyx/core/order";
import type { AccountSnapshot } from "@solyx/core/order";

import { exchangeRateQuery } from "../macro/macro-query.ts";
import { numberFormats } from "../market/number-formats.ts";
import { quoteQuery } from "../market/quote-query.ts";

/**
 * What an account holding both currencies is worth in Taiwan dollars, its cash and its holdings at
 * their last prices, at the US dollar's newest close; nothing for an account holding one.
 */
export function TwdTotal({
  cash,
  positions,
}: Pick<AccountSnapshot, "cash" | "positions">) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  const both = Object.values(Currency).every(
    (currency) =>
      currency in cash ||
      positions.some(
        ({ instrument }) => currencyOf(instrument.market) === currency
      )
  );

  const rate = useQuery({ ...exchangeRateQuery(), enabled: both });

  const quotes = useQueries({
    queries: positions.map((position) => quoteQuery(position.instrument)),
  });

  if (!both) return null;

  const lasts = quotes.map(({ data }) => data?.last);
  const exchange = rate.data;

  // A sum that left out a currency's cash or a holding's price would pass for the whole.
  const worth =
    exchange &&
    Object.values(cash).every((amount) => amount !== null) &&
    lasts.every((last) => last !== undefined)
      ? sumBy(Object.values(Currency), (currency) =>
          inTwd(cash[currency] ?? 0, currency, exchange)
        ) +
        sumBy(positions, (position, index) =>
          inTwd(
            positionValue(position, lasts[index] ?? 0).value,
            currencyOf(position.instrument.market),
            exchange
          )
        )
      : null;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-muted">{t("account.twd-total")}</span>
        <span className="text-xl font-semibold tabular-nums">
          {worth === null ? "–" : format.wholeAmount.format(worth)}
        </span>
      </div>
      <p className="text-xs text-muted tabular-nums">
        {rate.isError
          ? t("account.twd-total-unrated")
          : exchange
            ? t("account.twd-total-rate", {
                date: exchange.date,
                rate: exchange.twdPerUsd,
              })
            : null}
      </p>
    </div>
  );
}
