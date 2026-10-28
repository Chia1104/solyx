import { uniqBy } from "es-toolkit";

import { AppPlace } from "@solyx/agent/prompt";
import type { ContextListing, TurnContext } from "@solyx/agent/prompt";
import { messageTokens } from "@solyx/agent/wire";
import { ScreenKind } from "@solyx/api/agent";
import type { AgentScreen } from "@solyx/api/agent";
import type { BacktestSetup } from "@solyx/api/backtests";
import { ChartIndicator } from "@solyx/api/chart-indicator";
import { OverviewTab } from "@solyx/api/overview-tab";
import { yearsBefore } from "@solyx/core/candles";
import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { setupRules } from "@solyx/core/strategy-templates";

/** An indicator the chart draws, in the words the agent's tools use for it. */
const INDICATOR_WORDS: Record<ChartIndicator, string> = {
  [ChartIndicator.MovingAverage]: "short MAs",
  [ChartIndicator.LongMovingAverage]: "long MAs",
  [ChartIndicator.Bollinger]: "Bollinger Bands",
  [ChartIndicator.Vwap]: "VWAP",
  [ChartIndicator.Macd]: "MACD",
  [ChartIndicator.Rsi]: "RSI",
  [ChartIndicator.Kd]: "KD",
  [ChartIndicator.VolumeRatio]: "volume over its average",
  [ChartIndicator.RelativeStrength]: "relative strength",
  [ChartIndicator.YearRange]: "52-week range",
  [ChartIndicator.Zones]: "support zones",
  [ChartIndicator.VolumeProfile]: "volume profile",
  [ChartIndicator.SessionLevels]: "session levels",
  [ChartIndicator.ForeignFlow]: "foreign net buying",
  [ChartIndicator.TrustFlow]: "investment trust net buying",
  [ChartIndicator.DealerFlow]: "dealer net buying",
  [ChartIndicator.Margin]: "margin balances",
  [ChartIndicator.Short]: "short balances",
  [ChartIndicator.ForeignHolding]: "foreign holding ratio",
};

const PLACE_OF_TAB: Record<OverviewTab, AppPlace> = {
  [OverviewTab.Today]: AppPlace.Moves,
  [OverviewTab.News]: AppPlace.Headlines,
  [OverviewTab.Calendar]: AppPlace.Calendar,
  [OverviewTab.Market]: AppPlace.Market,
};

/**
 * The call of the agent's that runs what the panel ran, its years back from `now` as the day they
 * start: `backtest.rules` with its template as the rules it writes, or `strategies.backtest` for a
 * strategy the user wrote.
 */
function backtestCall(
  { symbol, interval, years, strategy, ...options }: BacktestSetup,
  now: Date
) {
  const reach = {
    symbol,
    interval,
    since: yearsBefore(symbol.market, years, now),
  };

  if ("name" in strategy) {
    return `strategies.backtest(${JSON.stringify({ strategy: strategy.name, ...reach, params: strategy.params, ...options })})`;
  }

  return `backtest.rules(${JSON.stringify({ ...reach, strategy: setupRules(strategy), ...options })})`;
}

/** What a message's context says of the screen it was written at. */
export function screenContext(
  screen: AgentScreen | null,
  now: Date
): Pick<
  TurnContext,
  "focus" | "chart" | "backtest" | "place" | "settings" | "strategies"
> {
  switch (screen?.kind) {
    case ScreenKind.Listing:
      return {
        focus: { symbol: screen.symbol, name: screen.name },
        chart: {
          interval: screen.interval,
          indicators: screen.indicators.map(
            (indicator) => INDICATOR_WORDS[indicator]
          ),
        },
        backtest: screen.backtest && backtestCall(screen.backtest, now),
      };
    case ScreenKind.Overview:
      return { place: PLACE_OF_TAB[screen.tab] };
    case ScreenKind.Settings:
      return { settings: screen.section.replaceAll("-", " ") };
    case ScreenKind.Strategies:
      return { strategies: { name: screen.name } };
    default:
      return {};
  }
}

export interface MessageContextSources {
  /** The listing on screen, named as the renderer shows it. */
  focus: ContextListing | null;
  watchlist(): readonly SymbolRef[];
  /** What the account holds, asked only for a code the screen and the watchlist miss, since a live broker answers over the network. */
  holdings(): Promise<readonly SymbolRef[]>;
  /** The exchange's name for a listing, when its source knows it. */
  name(symbol: SymbolRef): Promise<string | undefined>;
  /** Listings in any market whose code is `code`, as the app's search finds them, for one the rest miss. */
  find(code: string): Promise<readonly SymbolRef[]>;
  /** The skills the user may ask for with `/name`. */
  commands(): Promise<readonly string[]>;
}

/**
 * The listings a message names with `@` and the skill its leading `/name` asks for, as far as
 * the app knows them. A token naming neither stays the user's text, and a source that fails
 * leaves out what only it knew rather than failing the message.
 */
export async function messageContext(
  text: string,
  sources: MessageContextSources
) {
  const { skill, codes } = messageTokens(text);

  const near = [
    ...(sources.focus ? [sources.focus.symbol] : []),
    ...sources.watchlist(),
  ];

  const named = (listings: readonly SymbolRef[], code: string) =>
    listings.find((listing) => listing.symbol.toUpperCase() === code);

  const held = codes.some((code) => !named(near, code))
    ? await sources.holdings().catch(() => [])
    : [];

  const known = [...near, ...held];

  const found = await Promise.all(
    codes.map(async (code) => {
      const listing = named(known, code);

      return listing ? [listing] : await sources.find(code).catch(() => []);
    })
  );

  const symbols = uniqBy(found.flat(), symbolKey);

  const focusKey = sources.focus && symbolKey(sources.focus.symbol);

  const mentions = await Promise.all(
    symbols.map(async (symbol): Promise<ContextListing> => {
      const name =
        symbolKey(symbol) === focusKey
          ? sources.focus?.name
          : await sources.name(symbol).catch(() => undefined);

      return name ? { symbol, name } : { symbol };
    })
  );

  const asked =
    skill !== undefined && (await sources.commands()).includes(skill)
      ? skill
      : undefined;

  return { mentions, skill: asked };
}
