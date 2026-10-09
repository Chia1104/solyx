# `@solyx/trading-chart`

React bindings for Lightweight Charts v5: `<Chart>` owns one chart, `<Series>` adds one series to it with its price lines, markers and price bands, and `exchangeTimeFormat` renders UTC timestamps in an exchange's time zone.

## Boundaries

- Stays domain-free: no `@solyx/*` imports; callers map candles and indicators to Lightweight Charts data.
- Style with inline styles, not Tailwind classes; the renderer's Tailwind build does not scan this package.
- `<Series>` recreates its series only when the definition or pane changes and updates everything else in place, so pass stable `options`, `priceLines`, `markers`, `bands` and `priceScale` references. Data that differs from the last render only in its final item, or by one appended item, goes through `update`; anything else resets the series with `setData`.
- Price bands are a series primitive drawn behind its bars, and they never widen its price scale, so a band shows only where its prices are in view.
- React unmounts `<Chart>` before its children, and removing the chart removes its series, so a child that frees chart resources on unmount checks `isChartRemoved` first.
- Keep TradingView's attribution logo enabled; Lightweight Charts' license requires crediting TradingView.
