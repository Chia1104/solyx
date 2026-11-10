---
type: fact
title: How to diagnose a local Solyx Nightly "crash" on macOS; what survives on disk and what only Sentry has
status: active
author: agent:import
confidence: medium
created: 2026-11-10
updated: 2026-11-11
tags:
  - imported/claude-code
  - reference
approved_at: 2026-11-10
approved_by: auto-approve
---

# How to diagnose a local Solyx Nightly "crash" on macOS; what survives on disk and what only Sentry has

Investigated 2026-10-29 (nightly .140, e7d31697): the app "crashed" because the backend utility process died, the main process showed the backend-stopped dialog and `app.exit(1)` after the click.

- Before PR #384 (opened 2026-10-30, merged) Sentry got nothing from such a crash: `showErrorBox` held the main thread and `app.exit(1)` dropped the queued reports. #384 flushes first, puts `Exit code N · reason · ErrorType` in the dialog and keeps a record per crash in `<userData>/crashes/<iso>.json` (newest 20; error type + frames, never the message). Once a build has it, read that folder first. The user plans a CLI that exports these records for issues (Linear CHI-23).
- The backend's stdout/stderr is not written anywhere when launched from Finder/Dock. On 2026-10-29 the Sentry MCP here saw only `bridgefy`/`leadbest`, not Solyx's org; since 2026-11-02 it is signed in to org `chia1104`, whose project `solyx-desktop` is this app's (see [[solyx-observability]]).
- Electron 45 facts (probed 2026-10-30): a utility's `exit` comes ~10 ms before `child-process-gone`; `gone` never fires for a clean exit or a parent kill; `details.name` is the fork's `serviceName`; `exit` code is 1 for exit(1) and the signal number for a crash, while `gone.exitCode` is the raw wait status (256).
- `pgrep -f '<pattern>'` from a Bash call matches the shell running that very command; pick PIDs by exact executable and `--utility-sub-type=node.mojom.NodeService` instead.
- Use `/usr/bin/log show`, not `log`: zsh's `log` builtin shadows it ("too many arguments").
- `launchd` lines say how the main process ended (`exited due to exit(1), ran for Nms`); runningboardd's `termination reported by launchd (0, 0, 256)` is exit(1), not a signal. A signal crash would leave a `Solyx Nightly*.ips` in `~/Library/Logs/DiagnosticReports`.
- The dialog shows up in the main process's log as iconservices connections plus `makeKeyWindow ... _NSGlassEffectWindow`, which dates the backend's death to within a second.
- userData is `~/Library/Application Support/Solyx Nightly`; config `~/.solyx-nightly/config.json` (`crashReports.send`, `otlp` empty there). Activity can be timed from `cache.sqlite` `kept_answers.asked_at` and `agent.sqlite` entries' `$.model[0].timestamp` (ms).
- To catch the next one with a stack: quit the app and run `"/Applications/Solyx Nightly.app/Contents/MacOS/Solyx Nightly"` from a terminal; utility processes inherit its stdio.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-nightly-crash-diagnosis.md`, type `reference`).
