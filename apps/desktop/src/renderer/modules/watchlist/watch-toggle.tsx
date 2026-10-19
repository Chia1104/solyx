import { ToggleButton, Tooltip, cn } from "@heroui/react";
import { StarIcon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { isEqual } from "es-toolkit";
import { useTranslation } from "react-i18next";

import type { SymbolRef } from "@solyx/core/market";

import { client } from "../../app/rpc.ts";
import { Icon } from "../../components/icon.tsx";

import { watchlistQuery } from "./watchlist-query.ts";

const TOOLTIP_DELAY = 600;

/** Adds the open listing to the watchlist or takes it off; the star is filled while it is on. */
export function WatchToggle({ symbol }: { symbol: SymbolRef }) {
  const { t } = useTranslation();
  const { data } = useQuery(watchlistQuery());

  const watched = data?.some((other) => isEqual(other, symbol)) ?? false;

  const update = useMutation({
    mutationFn: () =>
      watched ? client.watchlist.remove(symbol) : client.watchlist.add(symbol),
  });

  const label = watched ? t("watchlist.remove") : t("watchlist.add");

  return (
    <div className="flex items-center gap-2">
      {update.error ? (
        <span role="alert" className="text-xs text-danger">
          {t("watchlist.update-failed")}
        </span>
      ) : null}
      <Tooltip delay={TOOLTIP_DELAY}>
        <ToggleButton
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={t("watchlist.title")}
          isSelected={watched}
          isDisabled={!data || update.isPending}
          onChange={() => update.mutate()}>
          <Icon icon={StarIcon} className={cn(watched && "fill-current")} />
        </ToggleButton>
        <Tooltip.Content>{label}</Tooltip.Content>
      </Tooltip>
    </div>
  );
}
