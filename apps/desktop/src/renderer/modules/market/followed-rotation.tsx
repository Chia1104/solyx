import { useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { uniqBy } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { symbolKey } from "@solyx/core/market";
import { MAX_ROTATION_LISTINGS } from "@solyx/core/rotation";

import { orpc } from "../../app/rpc.ts";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { watchlistQuery } from "../watchlist/watchlist-query.ts";

import { LINE_COLORS } from "./chart-palette.ts";
import { ListingName } from "./listing-name.tsx";
import { listingRotationsQuery } from "./quote-query.ts";
import { RotationGraph } from "./rotation-graph.tsx";

const HELD = "held";

const WATCHED = "watched";

/**
 * What the user holds and watches on a relative rotation graph against each market's index,
 * held first and each once; a listing held and watched counts as held. An account that fails to
 * read leaves the watchlist.
 */
export function FollowedRotation() {
  const { t } = useTranslation();
  const account = useQuery(orpc.account.summary.queryOptions());
  const watchlist = useQuery(watchlistQuery());

  const held = new Set(
    (account.data?.positions ?? []).map(({ instrument }) =>
      symbolKey(instrument)
    )
  );

  const symbols = uniqBy(
    [
      ...(account.data?.positions ?? []).map(
        ({ instrument: { market, symbol } }) => ({ market, symbol })
      ),
      ...(watchlist.data ?? []),
    ],
    symbolKey
  ).slice(0, MAX_ROTATION_LISTINGS);

  const [through, setThrough] = useState<string | null>(null);
  const rotations = useQuery(listingRotationsQuery(symbols, through));

  if (account.isPending || watchlist.isPending) return <LoadingState />;

  if (symbols.length === 0) {
    return <p className="text-sm text-muted">{t("heat-map.empty")}</p>;
  }

  if (rotations.error) {
    return (
      <LoadError
        error={rotations.error}
        onRetry={() => void rotations.refetch()}
      />
    );
  }

  if (rotations.data === undefined) return <LoadingState />;

  return (
    <RotationGraph
      playback={{
        sessions: rotations.data.sessions,
        through,
        onChange: setThrough,
      }}
      entries={rotations.data.entries.map(({ symbol, readings }) => ({
        id: symbolKey(symbol),
        name: symbol.symbol,
        title: (
          <>
            <span className="font-medium">{symbol.symbol}</span>{" "}
            <ListingName symbol={symbol} className="font-normal" />
          </>
        ),
        group: held.has(symbolKey(symbol)) ? HELD : WATCHED,
        readings,
        symbol,
      }))}
      groups={[
        { id: HELD, label: t("account.positions"), color: LINE_COLORS.fast },
        { id: WATCHED, label: t("watchlist.title"), color: LINE_COLORS.slow },
      ]}
    />
  );
}
