import { escape } from "es-toolkit";

import type { SignInOutcome } from "@solyx/agent/chatgpt-oauth";
import enUS from "@solyx/i18n/desktop/en-US.json" with { type: "json" };
import zhTW from "@solyx/i18n/desktop/zh-TW.json" with { type: "json" };

import { Locale } from "#shared/ipc/settings.ts";

import { PRODUCT_NAME } from "../../product.ts";

// The same inks and rules as the renderer's styles.css and sheets, since the browser shows this
// page outside the app.
const STYLE = `
:root {
  color-scheme: light dark;
  --background: oklch(96.95% 0.0045 258.3);
  --foreground: oklch(27.22% 0.016 264.3);
  --muted: oklch(52.98% 0.0255 263.1);
  --separator: oklch(90.57% 0.0105 261.8);
  --hatch: color-mix(in oklab, var(--muted) 40%, transparent);
}
@media (prefers-color-scheme: dark) {
  :root {
    --background: oklch(19% 0.0181 259.7);
    --foreground: oklch(93% 0.0104 261.8);
    --muted: oklch(66.45% 0.0291 262.3);
    --separator: oklch(29.1% 0.0287 259.1);
    --hatch: color-mix(in oklab, var(--muted) 35%, transparent);
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--background);
  color: var(--foreground);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC",
    "Microsoft JhengHei", "Noto Sans TC", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.title-bar { display: flex; flex-shrink: 0; align-items: center; height: 2.75rem; padding: 0 1.5rem; font-weight: 600; }
.band {
  flex-shrink: 0;
  height: 6px;
  background-image: repeating-linear-gradient(315deg, var(--hatch) 0 1px, transparent 0 50%);
  background-size: 8px 8px;
}
.ruled { border-bottom: 1px solid var(--separator); }
.column { width: 100%; max-width: 48rem; margin: 0 auto; padding: 0 1.5rem; }
@media (min-width: 50rem) { .column { border-inline: 1px solid var(--separator); } }
header .column { display: flex; align-items: center; height: 2.75rem; }
section .column { padding-block: 1.25rem; }
h1 { margin: 0; font-size: 14px; font-weight: 600; }
h2 { margin: 0 0 0.25rem; font-size: 16px; font-weight: 600; }
p { margin: 0; max-width: 65ch; color: var(--muted); }
code {
  display: block;
  color: var(--muted);
  font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.rest { display: flex; flex: 1; }
`;

/** The sign-in the browser returns from, which picks the page's copy. */
export const SignInFlow = {
  ChatGPT: "chatgpt",
  Mcp: "mcp",
} as const;

export type SignInFlow = (typeof SignInFlow)[keyof typeof SignInFlow];

/**
 * The page the browser lands on when a sign-in returns, in the app's language and drawn like its
 * window, with the error the provider sent when it sent one.
 */
export function signInPage(
  locale: Locale,
  flow: SignInFlow,
  outcome: SignInOutcome,
  detail?: string
): string {
  const catalog = locale === Locale.ZhTW ? zhTW : enUS;
  const page = catalog["sign-in-page"][flow];
  const copy = page[outcome];

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(copy.title)} – ${PRODUCT_NAME}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="title-bar">${PRODUCT_NAME}</div>
<div class="band" aria-hidden="true"></div>
<header class="ruled"><div class="column"><h1>${escape(page.label)}</h1></div></header>
<main>
<section class="ruled"><div class="column">
<h2>${escape(copy.title)}</h2>
<p>${escape(copy.body)}</p>
</div></section>
${detail ? `<section class="ruled"><div class="column"><code>${escape(detail)}</code></div></section>` : ""}
</main>
<div class="rest"><div class="column"></div></div>
</body>
</html>`;
}
