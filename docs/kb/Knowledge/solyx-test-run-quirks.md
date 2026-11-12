---
type: fact
title: "Running solyx tests and scripts locally: exclude .delta worktrees from vp test, run package code with plain node, zsh does not split $pids, a piped vp check hides its failure"
status: active
author: agent:import
confidence: medium
created: 2026-11-10
updated: 2026-11-10
tags:
  - imported/claude-code
  - reference
approved_at: 2026-11-10
approved_by: auto-approve
---

# Running solyx tests and scripts locally: exclude .delta worktrees from vp test, run package code with plain node, zsh does not split $pids, a piped vp check hides its failure

Seen 2026-10-12 in the solyx checkout:

- The repo holds another tool's copies under `.delta/worktrees/` and `.delta/clones/` (listed in `.git/info/exclude`, so git ignores them and Vitest does not). `vp test run <path>` also runs their test files, which fail on unresolved `@solyx/*` imports. Run `vp test run --exclude '.delta/**'`; such failures say nothing of the change. Since 2026-10, stale agent worktrees under `.claude/worktrees/` get swept in the same way (their `backup-threads.test.ts` errors); add `--exclude '.claude/**'`.
- Package and desktop main modules run under plain Node 26 without a build: from `packages/<name>` or `apps/desktop`, `node --input-type=module -e 'import … from "./src/….ts"'` resolves `@solyx/*`. Useful for reading a live source through a new provider, or the desktop modules outside Electron.
- The shell is zsh, which does not split `$pids`: pipe `pgrep -f … | xargs kill` instead of `kill $pids`.
- `vp check 2>&1 | tail -2 && … && git commit` does not stop on a failing check: the pipe's status is `tail`'s. Twice a commit went out with lint errors this way (2026-10-12 and 2026-10-13, both fixed by amending). Write the output to a file and test `$?`, or run `vp check` unpiped, before any commit or push.
  The same holds for `vp test … | grep … && git commit`: on 2026-10-15 a commit went out after one failing test that way (`apps/desktop/tests/telemetry.test.ts`, "traces and logs go to the endpoint…", which then passed 5 runs alone and 3 full-suite runs: flaky, unrelated to the change). Check the counts before committing.
- Plain `node` on this machine is 22, which lacks Temporal, so core code that reads an exchange's date fails there; run scripts with `vp exec node` (Node 26).
- `echo ====` fails in zsh (`=` expansion); use another separator.
- A glob that matches nothing aborts the whole zsh command (`no matches found`), so `rm -rf dir /tmp/x-*.png` removes nothing when no png is left; keep globs out of cleanup commands and check the folders are gone (seen 2026-10-18).
- Code that starts a worker thread, such as the agent's script runner, fails under `node --input-type=module -e` ("--input-type can only be used with string input"), since the worker inherits the flag. Write the probe to a `.mjs` file in the package, run it, and delete it.

Related: [[solyx-isolated-smoke-run]]

- CI runs `vp run -r test` (each package's own `vp test`), not a root `vp test run`, and the two can disagree. Seen 2026-10-24 on #303: `@opentelemetry/api` existed at 1.9.1 (Sentry) and 1.10.0 (agent, backend); vitest takes it as an optional peer, so pnpm installed two `vite-plus@1.4.0` copies, and every agent test failed only per-package with "Vitest failed to find the current suite". Fixed by an `overrides` entry pinning the API to `catalog:otel`. Check with `readlink -f packages/*/node_modules/vite-plus` that every package shares one copy, and run `vp run -r test` before pushing a dependency bump. Right after such an install, the first `vp run -r test` can fail with ENOTEMPTY on `node_modules/.vitest-cache` (parallel cache clears); rerun.
- `packages/backend/tests/backup-threads.test.ts` flakes with `RangeError: Invalid time value` from `packages/backup/tests/fixtures/fake-s3.ts` (signRequest on a missing `x-amz-date`), on develop too: 1 in 2 runs on 2026-10-30. Not caused by the change under test; unfixed (Linear CHI-78).

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-test-run-quirks.md`, type `reference`).
