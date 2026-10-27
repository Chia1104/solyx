import { scaleSqrt } from "d3-scale";
import { useTranslation } from "react-i18next";

import type { CalibrationBucket } from "@solyx/core/forecast";
import { cssPercent } from "@solyx/utils/format";

import { ChartMark } from "../../components/chart-mark.tsx";
import { numberFormats } from "../market/number-formats.ts";

/** The largest dot's diameter in pixels, for the bucket that holds the most scenarios. */
const MOST = 16;

const LEAST = 6;

/**
 * How often the scenarios given each band of probability came true, against the dashed diagonal
 * where they would come true just as often as given; each dot is sized by how many scenarios it
 * stands for, and pointing at one names them. Nothing is drawn until a forecast has settled.
 */
export function CalibrationChart({
  buckets,
}: {
  buckets: readonly CalibrationBucket[];
}) {
  const { t, i18n } = useTranslation();
  const { percent } = numberFormats(i18n.language);
  const stated = buckets.filter(({ scenarios }) => scenarios > 0);

  if (stated.length === 0) return null;

  const size = scaleSqrt()
    .domain([0, Math.max(...stated.map(({ scenarios }) => scenarios))])
    .range([LEAST, MOST]);

  const describe = ({ from, to, scenarios, held }: CalibrationBucket) =>
    t("research.forecasts.calibration-bucket", {
      from,
      to,
      scenarios,
      held,
      rate: percent.format(held / scenarios),
    });

  return (
    <figure
      aria-label={t("research.forecasts.calibration-label")}
      className="flex w-48 shrink-0 flex-col gap-1.5">
      <div className="flex gap-2">
        <div
          aria-hidden
          className="flex flex-col justify-between text-[10px] leading-none text-muted tabular-nums">
          <span>{percent.format(1)}</span>
          <span>{percent.format(0)}</span>
        </div>
        <div className="relative h-28 flex-1 border-b border-l border-separator">
          <svg
            aria-hidden
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible text-muted/60">
            <line
              x1={0}
              y1={100}
              x2={100}
              y2={0}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <ol>
            {stated.map((bucket) => (
              <li key={bucket.from}>
                <ChartMark
                  label={describe(bucket)}
                  className="inset-auto -translate-x-1/2 translate-y-1/2 rounded-full bg-accent ring-2 ring-surface hover:bg-accent focus-visible:bg-accent"
                  style={{
                    left: cssPercent((bucket.from + bucket.to) / 200),
                    bottom: cssPercent(bucket.held / bucket.scenarios),
                    width: size(bucket.scenarios),
                    height: size(bucket.scenarios),
                  }}
                />
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div
        aria-hidden
        className="flex gap-2 text-[10px] leading-none text-muted tabular-nums">
        {/* As wide as the probabilities' labels, so these run under the plot alone. */}
        <span className="invisible">{percent.format(1)}</span>
        <span className="flex flex-1 justify-between">
          <span>{percent.format(0)}</span>
          <span>{t("research.forecasts.calibration-given")}</span>
          <span>{percent.format(1)}</span>
        </span>
      </div>
      <figcaption className="text-xs text-muted">
        {t("research.forecasts.calibration")}
      </figcaption>
    </figure>
  );
}
