import { useState } from "react";

import { Input, Label, TextField } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { BENCHMARK, Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { SECTOR_GROUPS, SectorGroup } from "@solyx/core/sectors";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";

import { LINE_COLORS } from "./chart-palette.ts";
import { ListingName } from "./listing-name.tsx";
import { rotationsQuery } from "./quote-query.ts";
import { RotationGraph } from "./rotation-graph.tsx";

/** One colour per group of a market's sectors, none of them a price's. */
export const GROUP_COLORS: Record<SectorGroup, string> = {
  [SectorGroup.Electronics]: LINE_COLORS.fast,
  [SectorGroup.Finance]: LINE_COLORS.slow,
  [SectorGroup.Other]: LINE_COLORS.oscillator,
  [SectorGroup.Cyclical]: LINE_COLORS.fast,
  [SectorGroup.Sensitive]: LINE_COLORS.slow,
  [SectorGroup.Defensive]: LINE_COLORS.oscillator,
};

/** A TWSE code to read the sectors against in the TAIEX's place, taken as it is entered or left. */
function BenchmarkField({
  benchmark,
  onChange,
}: {
  benchmark: SymbolRef | null;
  onChange: (benchmark: SymbolRef | null) => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState(benchmark?.symbol ?? "");

  const commit = () => {
    const next = code.trim().toUpperCase();

    setCode(next);
    onChange(next === "" ? null : { market: Market.TW, symbol: next });
  };

  return (
    <TextField className="w-36">
      <Label>{t("heat-map.rotation.benchmark")}</Label>
      <Input
        value={code}
        placeholder={BENCHMARK[Market.TW].name}
        className="uppercase"
        onChange={(event) => setCode(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
    </TextField>
  );
}

/** Taiwan's listed sectors on a relative rotation graph against the TAIEX, or a TWSE listing picked here. */
export function SectorRotation() {
  const { t } = useTranslation();
  const [benchmark, setBenchmark] = useState<SymbolRef | null>(null);

  const { data, error, refetch, isFetching } = useQuery(
    rotationsQuery(benchmark)
  );

  const controls = (
    <BenchmarkField benchmark={benchmark} onChange={setBenchmark} />
  );

  let body;

  if (error && !data) {
    body = <LoadError error={error} onRetry={() => void refetch()} />;
  } else if (data === undefined) {
    body = <LoadingState />;
  } else if (data === null) {
    body = (
      <p className="text-sm text-muted">{t("heat-map.sectors.unavailable")}</p>
    );
  } else {
    return (
      <RotationGraph
        loading={isFetching}
        controls={
          <>
            {controls}
            {error ? (
              <p role="alert" className="basis-full text-xs text-danger">
                {error.message}
              </p>
            ) : null}
            {data.benchmark && benchmark ? (
              <p className="flex items-baseline gap-1 self-end pb-2 text-xs text-muted">
                {t("heat-map.rotation.against", {
                  name: data.benchmark.symbol,
                })}
                <ListingName symbol={data.benchmark} />
              </p>
            ) : null}
          </>
        }
        playback={data}
        entries={data.entries.map(({ sector, group, paths }) => ({
          id: sector,
          name: t(`sectors.names.${sector}`),
          group,
          paths,
        }))}
        groups={SECTOR_GROUPS[Market.TW].map((group) => ({
          id: group,
          label: t(`sectors.groups.${group}`),
          color: GROUP_COLORS[group],
        }))}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">{controls}</div>
      {body}
    </div>
  );
}
