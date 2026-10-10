import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { symbolKey } from "@solyx/core/market";
import type { Development, ThemeWatch } from "@solyx/core/theme";

import { SettingsSection } from "#shared/settings-section.ts";

import { useClock } from "../../app/clock.ts";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { ListingName } from "../market/listing-name.tsx";
import { numberFormats } from "../market/number-formats.ts";

import { themesQuery } from "./themes-query.ts";

/** An item read as stating a signpost, under the signpost it may have met. */
function DevelopmentRow({ development }: { development: Development }) {
  const { t, i18n } = useTranslation();
  const clock = useClock();
  const { percent } = numberFormats(i18n.language);
  const { signpost, item, support } = development;

  return (
    <li className="flex flex-col gap-0.5 rounded-sm border border-dashed border-separator px-2 py-1.5 text-xs">
      <span className="text-muted">{signpost}</span>
      {item.url ? (
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="truncate text-sm hover:underline">
          {item.title}
        </a>
      ) : (
        <span className="truncate text-sm">{item.title}</span>
      )}
      <span className="text-muted tabular-nums">
        {item.site} · {clock.date(item.published?.at.getTime() ?? item.foundAt)}{" "}
        ·{" "}
        {t("themes.read-as-stated", {
          share: percent.format(support.supported),
        })}
      </span>
    </li>
  );
}

/** One theme: what is watched and why, the listings it could reach, and whether a signpost may have been met. */
function ThemeRow({ watch }: { watch: ThemeWatch }) {
  const { t } = useTranslation();
  const clock = useClock();
  const { theme, developments, collectedAt, quietSince } = watch;

  return (
    <li className="flex flex-col gap-1.5 py-3">
      <div className="flex items-baseline gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {theme.title}
        </span>
        <span className="shrink-0 text-xs text-muted tabular-nums">
          {developments.length > 0
            ? t("themes.developments", { count: developments.length })
            : t("themes.quiet-since", { date: clock.date(quietSince) })}
        </span>
      </div>
      <p className="line-clamp-2 text-xs text-muted">{theme.thesis}</p>
      {theme.listings.length === 0 ? null : (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {theme.listings.map(({ symbol, exposure }) => (
            <Link
              key={symbolKey(symbol)}
              to="/symbol/$market/$symbol"
              params={symbol}
              title={exposure}
              className="flex min-w-0 items-baseline gap-1 hover:underline">
              <span className="shrink-0 font-medium">{symbol.symbol}</span>
              <ListingName symbol={symbol} className="text-muted" />
            </Link>
          ))}
        </div>
      )}
      {developments.length === 0 ? null : (
        <ul className="flex flex-col gap-1.5">
          {developments.map((development) => (
            <DevelopmentRow
              key={`${development.signpost}:${development.item.id}`}
              development={development}
            />
          ))}
        </ul>
      )}
      <span className="text-xs text-muted tabular-nums">
        {collectedAt === null
          ? t("themes.not-searched")
          : t("themes.searched", { time: clock.time(collectedAt) })}
      </span>
    </li>
  );
}

/**
 * The themes the user has the app watch, the ones a signpost may have been met for first; a theme
 * says nothing more than how long it has been quiet until then.
 */
export function ThemeList() {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(themesQuery());

  if (error) return <LoadError error={error} onRetry={() => void refetch()} />;

  if (!data) return <LoadingState />;

  return (
    <div className="flex flex-col gap-2">
      {data.length === 0 ? (
        <p className="rounded-sm pencil px-3 py-3 text-xs text-muted">
          {t("themes.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-separator">
          {data.map((watch) => (
            <ThemeRow key={watch.theme.id} watch={watch} />
          ))}
        </ul>
      )}
      <Link
        to="/settings"
        search={{ section: SettingsSection.Themes }}
        className="self-start text-xs text-muted underline">
        {t("themes.manage")}
      </Link>
    </div>
  );
}
