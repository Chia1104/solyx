import { useTranslation } from "react-i18next";

import { symbolKey } from "@solyx/core/market";
import type { Market } from "@solyx/core/market";
import { MAX_ROTATION_LISTINGS } from "@solyx/core/rotation";

import { LoadingState } from "../../components/loading-state.tsx";
import { useFollowed } from "../watchlist/use-followed.ts";

import { LINE_COLORS } from "./chart-palette.ts";
import { ListingName } from "./listing-name.tsx";
import { ListingsRotation } from "./listings-rotation.tsx";

const HELD = "held";

const WATCHED = "watched";

/**
 * What the user holds and watches in `market` on a relative rotation graph against its index,
 * held first and each once; a listing held and watched counts as held. An account that fails to
 * read leaves the watchlist.
 */
export function FollowedRotation({ market }: { market: Market }) {
  const { t } = useTranslation();
  const followed = useFollowed(market);
  const { held } = followed;
  const symbols = followed.symbols.slice(0, MAX_ROTATION_LISTINGS);

  if (followed.pending) return <LoadingState />;

  if (symbols.length === 0) {
    return <p className="text-sm text-muted">{t("heat-map.empty")}</p>;
  }

  return (
    <ListingsRotation
      market={market}
      symbols={symbols}
      entry={({ symbol, paths }) => ({
        id: symbolKey(symbol),
        name: symbol.symbol,
        title: (
          <>
            <span className="font-medium">{symbol.symbol}</span>{" "}
            <ListingName symbol={symbol} className="font-normal" />
          </>
        ),
        group: held.has(symbolKey(symbol)) ? HELD : WATCHED,
        paths,
        symbol,
      })}
      groups={[
        { id: HELD, label: t("account.positions"), color: LINE_COLORS.fast },
        { id: WATCHED, label: t("watchlist.title"), color: LINE_COLORS.slow },
      ]}
    />
  );
}
