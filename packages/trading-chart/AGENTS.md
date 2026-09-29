# `@solyx/trading-chart`

React bindings for Lightweight Charts v5: `<Chart>` owns one chart, `<Series>` adds one series to it, and `exchangeTimeFormat` renders UTC timestamps in an exchange's time zone.

## Boundaries

- Stays domain-free: no `@solyx/*` imports; callers map candles and indicators to Lightweight Charts data.
- Style with inline styles, not Tailwind classes; the renderer's Tailwind build does not scan this package.
- `<Series>` recreates its series only when the definition or pane changes and updates everything else in place, so pass stable `options`, `priceLines` and `priceScale` references.
- React unmounts `<Chart>` before its children, and removing the chart removes its series, so a child that frees chart resources on unmount checks `isChartRemoved` first.
- Keep TradingView's attribution logo enabled; Lightweight Charts' license requires crediting TradingView.
