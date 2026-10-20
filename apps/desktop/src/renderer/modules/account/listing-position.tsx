import { Button, ButtonGroup } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { orpc } from "../../app/rpc.ts";
import { numberFormats } from "../market/number-formats.ts";
import { useOpenSale } from "../proposals/show-ticket.ts";
import { TicketTab } from "../proposals/ticket-store.ts";

import { PositionGain, PositionReturn } from "./position-figures.tsx";
import { WatchedExits, sellableOf } from "./positions-table.tsx";

/**
 * What the account holds of one listing, marked at its last price, with a sale or an exit of it a
 * click away; nothing while it holds none.
 */
export function ListingPosition({ symbol }: { symbol: SymbolRef }) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);
  const openSale = useOpenSale();

  const { data: position } = useQuery({
    ...orpc.account.summary.queryOptions(),
    select: (account) =>
      account.positions.find(
        ({ instrument }) => symbolKey(instrument) === symbolKey(symbol)
      ),
  });

  if (!position) return null;

  const shares = sellableOf(position);

  return (
    <section
      aria-label={t("account.held")}
      className="flex flex-col gap-3 border-t border-separator pt-4">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div className="flex flex-col">
          <dt className="text-muted">{t("account.held")}</dt>
          <dd className="text-sm font-semibold tabular-nums">
            {t("order-form.count.shares", { count: position.quantity })}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-muted">{t("account.avg-price")}</dt>
          <dd className="text-sm font-semibold tabular-nums">
            {format.price.format(position.avgPrice)}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-muted">{t("account.unrealized-gain")}</dt>
          <dd className="font-medium tabular-nums">
            <PositionGain symbol={symbol} position={position} />
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-muted">{t("account.return")}</dt>
          <dd className="font-medium tabular-nums">
            <PositionReturn symbol={symbol} position={position} />
          </dd>
        </div>
        <div className="col-span-2 flex flex-col">
          <dt className="text-muted">{t("account.exits")}</dt>
          <dd className="tabular-nums">
            <WatchedExits symbol={symbol} />
          </dd>
        </div>
      </dl>
      <ButtonGroup size="sm" variant="tertiary" className="w-full [&>*]:flex-1">
        <Button onPress={() => openSale(symbol, shares, TicketTab.Order)}>
          {t("account.sell")}
        </Button>
        <Button onPress={() => openSale(symbol, shares, TicketTab.Exit)}>
          {t("account.set-exit")}
        </Button>
      </ButtonGroup>
    </section>
  );
}
