import { escape } from "es-toolkit";

import type { SignInOutcome } from "@solyx/agent/chatgpt-oauth";
import enUS from "@solyx/i18n/desktop/en-US.json" with { type: "json" };
import zhTW from "@solyx/i18n/desktop/zh-TW.json" with { type: "json" };

// The same inks as the renderer's styles.css, since the browser shows this page outside the app.
const STYLE = `
:root {
  color-scheme: light dark;
  --background: oklch(96.95% 0.0045 258.3);
  --foreground: oklch(27.22% 0.016 264.3);
  --muted: oklch(52.98% 0.0255 263.1);
  --accent: oklch(47.34% 0.2191 268);
}
@media (prefers-color-scheme: dark) {
  :root {
    --background: oklch(19% 0.0181 259.7);
    --foreground: oklch(93% 0.0104 261.8);
    --muted: oklch(66.45% 0.0291 262.3);
    --accent: oklch(70.47% 0.1541 272.5);
  }
}
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: var(--background);
  color: var(--foreground);
  font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC",
    "Microsoft JhengHei", "Noto Sans TC", system-ui, sans-serif;
}
main { max-width: 26rem; padding: 1.25rem 1.5rem; border-top: 2px solid var(--accent); }
main[data-outcome="failed"] { border-top-style: dashed; border-top-color: var(--muted); }
.name { margin: 0; font-size: 13px; font-weight: 600; color: var(--muted); }
h1 { margin: 0.25rem 0 0.5rem; font-size: 18px; }
p { margin: 0; color: var(--muted); }
code { display: block; margin-top: 0.75rem; font-size: 12px; overflow-wrap: anywhere; }
`;

/**
 * The page the browser lands on when a ChatGPT sign-in returns, in the app's language: signed in
 * in ink, or not connected in pencil, with OpenAI's error code when it sent one.
 */
export function signInPage(
  locale: string,
  outcome: SignInOutcome,
  detail?: string
): string {
  const catalog = locale === "zh-TW" ? zhTW : enUS;
  const copy = catalog["sign-in-page"][outcome];

  return `<!doctype html>
<html lang="${locale === "zh-TW" ? "zh-TW" : "en-US"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Solyx</title>
<style>${STYLE}</style>
</head>
<body>
<main data-outcome="${outcome}">
<p class="name">Solyx</p>
<h1>${escape(copy.title)}</h1>
<p>${escape(copy.body)}</p>
${detail ? `<code>${escape(detail)}</code>` : ""}
</main>
</body>
</html>`;
}
