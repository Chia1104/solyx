import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { SectorGroup } from "@solyx/core/sectors";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";

import { LINE_COLORS } from "./chart-palette.ts";
import { rotationsQuery } from "./quote-query.ts";
import { RotationGraph } from "./rotation-graph.tsx";

/** One colour per group of sectors, none of them a price's. */
const GROUP_COLORS: Record<SectorGroup, string> = {
  [SectorGroup.Electronics]: LINE_COLORS.fast,
  [SectorGroup.Finance]: LINE_COLORS.slow,
  [SectorGroup.Other]: LINE_COLORS.oscillator,
};

/** Taiwan's listed sectors on a relative rotation graph against the TAIEX. */
export function SectorRotation() {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(rotationsQuery());

  if (error) {
    return <LoadError error={error} onRetry={() => void refetch()} />;
  }

  if (data === undefined) return <LoadingState />;

  if (data === null) {
    return (
      <p className="text-sm text-muted">{t("heat-map.sectors.unavailable")}</p>
    );
  }

  return (
    <RotationGraph
      entries={data.map(({ sector, group, readings }) => ({
        id: sector,
        name: t(`sectors.names.${sector}`),
        group,
        readings,
      }))}
      groups={Object.values(SectorGroup).map((group) => ({
        id: group,
        label: t(`sectors.groups.${group}`),
        color: GROUP_COLORS[group],
      }))}
    />
  );
}
