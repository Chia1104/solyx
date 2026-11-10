---
type: fact
title: "Sentry crash reports + renderer source maps (opt-in, opened as PR #79 on 2026-10-10) and the planned Grafana OTLP traces; decisions and what is still open"
status: active
author: agent:import
confidence: medium
created: 2026-11-10
updated: 2026-11-10
tags:
  - imported/claude-code
approved_at: 2026-11-10
approved_by: auto-approve
---

# Sentry crash reports + renderer source maps (opt-in, opened as PR #79 on 2026-10-10) and the planned Grafana OTLP traces; decisions and what is still open

Decided 2026-10-10 with the user:

- **Sentry = project-collected, opt-in.** Off by default (`crashReports.send`), asked on the onboarding Welcome step ("Help improve Solyx") and switchable in Settings → About. Root AGENTS.md invariant 5 was rewritten to name the project's Sentry as a second host.
- **Grafana = traces only, bring-your-own.** Opened as PR #80 (branch `feat/otlp-traces`) on 2026-10-10, after #79 merged; a real dev run was confirmed in the user's Grafana Cloud Tempo (ap-southeast-1, datasource uid `grafanacloud-traces`, reachable through the Grafana MCP, which is the user's own account). `traces.endpoint` is in config (like OTEL_EXPORTER_OTLP_ENDPOINT, +/v1/traces). The secret `trace-headers` uses the OTEL_EXPORTER_OTLP_HEADERS format and is validated on save. The UI sits on the About tab. The pi-telemetry plan was dropped: pi-ai 1.0.3 only passes `telemetryContext` through and emits no spans, because spans come from pi-agent-core, which Solyx doesn't use. Instead `@solyx/agent/traces` uses pi-durable `GenerationTask`/`ToolTask` hooks (beforeRequest/afterResponse, beforeTool/afterTool) in a hooks-only extension offered in the toolset. Run spans open and close from the runtime's RunStart/RunEnd wire events in agent-service `onEvent`. Spans follow the GenAI semconv (`invoke_agent Solyx` → `chat <model>` with tokens and cost, `execute_tool <name>`). Scheduler passes are root spans. The desktop `traces` module holds a private BasicTracerProvider, never registered globally, so Sentry's or libraries' instrumentation can't feed it; it swaps its BatchSpanProcessor as settings change. Smoke-verified in the built app against local Anthropic and OTLP stand-ins. Not covered yet: MAGI unit calls (inside tool spans), compaction, news scoring and decisions model calls.

How the Sentry PR works: `@sentry/electron` 8.1.0 is in the `sentry` catalog. `startCrashReports` runs in `main/index.ts` before ready, in every packaged build that has a DSN. The gate is a wrapped base transport inside `makeElectronOfflineTransport`: it drops envelopes while the setting is off, queued ones included, so switching takes effect at once. `scrubEvent` is the only scrub point and also covers renderer events. The SentryMinidump integration is removed because minidumps hold process memory. The DSN reaches the bundle through tsdown `env` on the main pack config. `build` became a vite.config task with `cache.env: ["SENTRY_DSN"]`, and package.yml reads `vars.SENTRY_DSN`.

Renderer source maps (added 2026-10-10, same branch): `@sentry/vite-plugin` 5.4.1 runs only when `SENTRY_AUTH_TOKEN` is set. It emits hidden maps, uploads them under release `solyx@<version>` with commits linked (the user connected Sentry's GitHub app) and `telemetry: false`, then deletes them. An upload failure logs but does not fail the build. The package job now runs in the `release` environment, where the user put the `SENTRY_DSN` variable and the `SENTRY_AUTH_TOKEN` secret. `SENTRY_ORG`/`SENTRY_PROJECT` are variables of that environment too. Since 2026-11-02 the Sentry MCP (claude.ai connector) is signed in to org `chia1104` (region https://us.sentry.io), whose projects are `chia1104`, `chia1104-service` and `solyx-desktop`; `solyx-desktop` is this app's, so the MCP can be used for it. `@sentry/cli` is denied in `allowBuilds` because its binary comes from the platform package.

Open items: the first nightly after merging is the first real upload and commit link. A native crash of the main process is not reported. The main bundle's maps are not uploaded, since it is not minified.

t3code (reference): it has no Sentry. It sends PostHog analytics from the server only, default-on with an env-var opt-out. Operator OTLP is env or settings, off by default. Relay traces use an ingest-only Axiom token injected at build. Related: [[solyx-isolated-smoke-run]], [[solyx-release-pipeline]].

Diagnostics (2026-10-10, second commit on PR #80): the user picked OTLP logs → Loki for recovered failures. The setting was renamed to `otlp.endpoint` and the secret to `otlp-headers`, and the desktop module is now `telemetry` (tracer + logger providers, both private). `diagnostics.recovered` covers news.collect/news.embed/news.search.embed/research.watch/market.stream.restart and only logs. `diagnostics.report` covers agent.resume/app.close/scheduler.pass/telemetry.apply: it logs and calls Sentry `captureException` with an event tag. Logs carry `exception.type` and the HTTP status, never the message, because provider errors can echo part of a key. A private AsyncLocalStorage (`telemetry.within`) gives logs from a scheduled pass that pass's trace id. Lint `no-console` is on except in diagnostics.ts and `**/scripts/**`. Thrown-value params must be named `cause` because of anti-slop `no-unknown-parameters`.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-observability.md`, type `project`).
