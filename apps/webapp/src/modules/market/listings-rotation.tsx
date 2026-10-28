import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { Market, SymbolRef } from "@solyx/core/market";
import type { ListingHistory } from "@solyx/core/rotation";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { useMarketSources } from "../settings/settings-query.ts";

import { listingRotationsQuery } from "./quote-query.ts";
import { RotationGraph } from "./rotation-graph.tsx";
import type { RotationEntry, RotationGroup } from "./rotation-graph.tsx";

/**
 * Listings of one market on a relative rotation graph against its index, on adjusted bars, or
 * why they cannot be read; nothing is asked of a market whose source is not set up.
 */
export function ListingsRotation({
  market,
  symbols,
  entry,
  groups,
}: {
  market: Market;
  symbols: SymbolRef[];
  /** The graph's line for a listing read; `null` leaves it out. */
  entry: (listing: ListingHistory) => RotationEntry | null;
  groups: RotationGroup[];
}) {
  const { t } = useTranslation();
  const sources = useMarketSources();
  const unset = sources.data?.[market].ready === false;

  const rotations = useQuery({
    ...listingRotationsQuery(symbols),
    enabled: symbols.length > 0 && !unset,
  });

  if (unset) {
    return (
      <p className="text-sm text-muted">{t("heat-map.rotation.unavailable")}</p>
    );
  }

  if (rotations.error && !rotations.data) {
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
      loading={rotations.isFetching}
      playback={rotations.data}
      entries={rotations.data.entries.flatMap(
        (listing) => entry(listing) ?? []
      )}
      groups={groups}
    />
  );
}
