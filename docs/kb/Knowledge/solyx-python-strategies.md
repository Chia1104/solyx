---
type: fact
title: "Strategies in ~/.solyx/strategies (2026-10-26): skill-like folders in any language, run in the shell's sandbox, approved per version; live allowed (unsandboxed only by the user's own approval); look-ahead only warns; stack #327–#333 merged; 2026-10-27 agent authoring (save_strategy, /strategy) decided and commissioned"
status: active
author: agent:import
confidence: medium
created: 2026-11-10
updated: 2026-11-11
tags:
  - imported/claude-code
approved_at: 2026-11-10
approved_by: auto-approve
---

# Strategies in ~/.solyx/strategies (2026-10-26): skill-like folders in any language, run in the shell's sandbox, approved per version; live allowed (unsandboxed only by the user's own approval); look-ahead only warns; stack #327–#333 merged; 2026-10-27 agent authoring (save_strategy, /strategy) decided and commissioned

On 2026-10-25 the user asked how to design user-written trading strategies, Python scripts included, kept in `~/.solyx/strategies` and runnable by the agent. Only a design was proposed that day, and nothing was built yet (it is built and merged since, as the stacks below). The user's runtime choice is recorded below.

What I proposed:

- Python computes lines and the kernel still trades. Add a `{ line: name }` series to `ruleSeriesSchema`. The kernel already reads `lines: Float64Array[]`, so scan, walk forward, rolling and MCPT need no kernel change.
- A strategy is a folder `<name>/STRATEGY.md` (frontmatter like SKILL.md, with params shaped like TemplateParam and entry/exit rules) plus `strategy.py` with `lines(bars, params)`.
- The runtime is Pyodide in a sandboxed hidden Chromium renderer whose session blocks the network, with wheels bundled in the installer. Pyodide in a Node worker is not a sandbox (run_js, and ctypes reaching emscripten_run_script_string). The user's own Python would amount to the shell.
- A prefix re-run check guards against look-ahead.
- The agent runs strategies through run_analysis's `backtest.strategy` without approval. `save_strategy` asks before overwriting.

Measured on 2026-10-25 with Pyodide 314.0.7 (CPython 3.14.2) in Electron 45 on an Apple Silicon Mac. The probe is in /tmp/pyprobe and runs as the throwaway script `main.cjs`.

- A detached `WebContentsView` with sandbox and a partition that cancels every non-app request is not counted by `BrowserWindow.getAllWindows()`. Python's `run_js` sees no process, require or electron, and fetches to https, localhost and file all fail.
- Without the `disable-renderer-backgrounding` switch, the detached view runs about 5x slower: core start 4 s, and 60 parameter sets over 2500 bars take about 500 ms. With the switch, or in a hidden `BrowserWindow`, core start is about 0.9 s, numpy and pandas load in 0.3 s, 60 sets over 2500 bars take 82 ms, and over 40k bars 0.4 s.
- A hidden `BrowserWindow` breaks main's window counting, `activate`, `window-all-closed` and `show()` in `index.ts` and `main-window.ts`. It also stalls main for 105-148 ms while loading. The detached view stalls main for 16-55 ms.
- The sandbox renderer's working set is about 455 MB after pandas and computing (245 MB after the core alone). The wasm heap is 75 MB.
- On disk, the core is 13.4 MB, numpy and pandas with their dependencies add 7.5 MB, scipy adds 13.4, scikit-learn 4.4 and statsmodels about 8. Compressed with xz, the core and numpy and pandas come to about 12 MB. The installed Solyx Nightly app is 278 MB. Pyodide ships no TA-Lib.

Decision on 2026-10-25: after seeing the measurements, the user chose to run strategies on the user's own Python instead of the Pyodide sandbox. In auto mode, the decisions model judges whether a run may go ahead.
What follows from that:

- The shell's `COMMAND_QUESTIONS.runs` flags every `python file.py`, so the judge needs its own question set over the code itself, plus a new eval script.
- Code longer than Jev's 12k characters is asked about, not cut.
- Each approval or judgement is tied to the content hash of the strategy version, not to each call.
- My proposal is a deterministic AST gate (import allowlist, no open/exec/getattr, no pandas I/O) in front of the model.
  Still open on 2026-10-25 (decided 2026-10-26 as B, below): whether strategies may run while the desk trades a live account. The shell is off then. Electron's safeStorage key is under DPAPI on Windows and in libsecret on Linux, so a script running as the same user could unseal the broker password. My recommendation is the shell's rule (paper only) at first.
  Other questions open then, both settled below (the aligned design and the 2026-10-27 decisions): what the agent may save unasked, and paired browsers running only versions already approved.

**Aligned design, 2026-10-26, after PR #326 (the shell sandbox) merged.**

- The user wants strategies that are skill-like and not limited to Python. The user writes them and owns their health. The app provides the sandbox and the auto check, and live accounts should be able to use them.
- A strategy is `strategies/<name>/STRATEGY.md`, with frontmatter holding `run`, `params`, `entry`/`exit` over `{ line }`, plus any files. Folder name equals name, as for skills.
- The process contract is JSON in and JSON out. The app writes `input.json` with the bars and `jobs: [{ id, params, length }]`. The strategy writes `output.json` with `{ id: { line: [...] } }`. Many jobs go in one run because each start costs the sandbox and the interpreter.
- Runs use the shell's `createSandbox().wrap`. `SandboxManager` is a singleton, so it moves out of `createShell` and is shared. Writes go to a per-run folder, the strategy folder and PATH tools are readable, and there is no network.
- Approval is per version, by content hash. ask asks, auto lets the decisions model judge the code (a new question set plus `eval-strategies.ts`; over 12k chars asks), and bypass runs. Pressing run in the panel counts as approval. `run_analysis` runs only allowed versions, and a guarded `allow_strategy` tool does the allowing. Paired browsers run only allowed versions.
- Live signals go through a scheduled task, `strategy.signal` and `propose_order`, with no new road to orders.

**User's decisions, 2026-10-26:**

- (1) B: on Windows or with the sandbox off, a strategy may run beside a live account, but only versions the user approved by hand. Auto does not count, and in my reading bypass does not either.
- (2) A failed look-ahead check only warns, and the user judges.

Stack commissioned by the user on 2026-10-26 ("ok 這可以"):

- core lines plus the look-ahead warning
- strategy catalog, runner and approvals, with the root invariant 1 wording
- decisions questions plus the eval
- agent functions and `allow_strategy`
- the panel and the approval card with a diff
- docs

**Built so far, 2026-10-26:**

- #327 `feat/strategy-lines` (core): `{ line }` series, `strategyBars` (first bar's terms), `MAX_LINE_VALUES`, and `@solyx/core/strategy` (manifest, jobs, input/output, `lookAhead`).
- #328 `feat/strategy-runner` (backend): catalog, sealed approvals (`strategy-approvals` secret, by user|check|mode, `outside` flag, `approvalAllows`), and a runner that copies the read bytes and runs the copy, after a security review flagged a TOCTOU/pycache/link gap. Links are refused, the sandbox is shared from services, and invariant 1 was edited.
- #329 `feat/strategy-code-judge` (decisions): `CodeJudge` with four questions, `eval-code.ts` and the shared `judge-eval.ts`. Jev's unsafe min worst is 0.72 against a safe max of 0.25; Luna's is 0.98 against 0.02; the threshold is 0.3.
- #331 `feat/strategy-agent`: run_analysis gains `strategies.backtest`, `scan`, `walkForward`, `rolling` and `signal`, with core `ruleSignal` matching the kernel. `get_strategy` and `allow_strategy` (args name+version, auto threshold 0.3, live+unsandboxed only the user, bypass none) are offered only when the user has a strategy. The approval rules moved to core. eval-backtests was not rerun, since the skill and the rules are unchanged.
- #332 `feat/strategy-panel` (webapp): own strategies in the backtest panel (My strategies, its numbers, grids along two of them), the allow box with a diff against the last allowed version (snapshots in `userData/strategy-versions`), the agent's allow_strategy card, the look-ahead warning at the head of a run's warnings. Two security reviews fixed it: compare files by sha256 digest (6d3853c2), and show a file as text whenever it is text now, so a binary turned script is never hidden (7410cc25).
- #333 `docs/website-strategies`: /docs/strategies in en-US and zh-TW with one strategy in Python and Node (both run against the core contract, agree to 1e-14), edits to backtests, data/backtests, files, backup, extensions, and the privacy policy and terms (2026-10-26). The legal edits are worth the user's read, since zh-TW prevails.
- Smoke-run in the built app (throwaway identity "Solyx Strat", kit /tmp/solyx-strat): picker, allow box, diff, sandboxed Python run, look-ahead warning, a 100-cell scan. Not seen: the agent's allow_strategy card in a real conversation (Linear CHI-27). Not measured: Cloudflare's code judge. eval-backtests was not rerun (Linear CHI-26).
- The stack was native and is merged into develop (see [[solyx-stacked-pr-merges]]).

**Proposed 2026-10-26: the agent helps write strategies.** A guarded `save_strategy` tool (whole text files into `strategies/<name>/`, manifest parsed before writing, the card a diff against the folder now) whose approval also allows that version; in auto, new strategies or ones this conversation made save unasked once the code judge passes, while edits to the user's own always ask; a sandboxed runtime probe (python3, numpy/pandas, node, uv) in `get_strategy`; `strategies.lines` in run_analysis for checking lines; a built-in `/strategy` skill; an eval of written strategies. Open for the user: combined save+allow, auto rules, an advisory or enforced guard against tuning on the holdout, skill placement.

**User's decisions, 2026-10-27** (the stack #327–#333 merged into develop by then): (1) saving is allowing, one approval; (2) auto saves new strategies or this conversation's own unasked once the code judge passes, edits to the user's own always ask; (3) the holdout guard is advisory only (fix the hypothesis before reading OOS, report how many versions were tried); (4) a separate `/strategy` skill that leans on `/backtest` for judging. Taken as commissioning the build.

**Built 2026-10-27** as native stack #335 (backend save/draft/probe) → #336 (agent: save_strategy, get_runtimes, strategies.lines, /strategy skill, backend/scripts/eval-strategies.ts) → #337 (webapp save card, 存成我的策略, 請 Agent 一起寫) → #338 (docs + terms dated 2026-10-27), all merged since.

- Eval (opus-5-5, bypass): 5/5 pass after skill step 1 was changed to "write a strategy when asked even if rules could say it" (before, z-score was answered with Bollinger rules and nothing saved). Centred-window trap: agent refuses and explains. Replies state versions saved and settings tested.
- Smoke-run seen: both save cards, saving lets the panel run it, both panel buttons draft. Kit /tmp/solyx-author (scripted model: get_runtimes → save_strategy, "改" → change with version).
- Found, not fixed: /usr/bin/python3 in the Seatbelt sandbox costs ~1 s per start and prints xcrun cache errors (can't write xcrun_db to the system temp folder); bun stalls ~5 s there and fails.

**Strategies page, decided 2026-10-27** (commissioned): a standalone page `#/strategies` with a title-bar button beside settings; list (where code runs, interpreters, state per strategy: allowed by whom / changed since allowed / not allowed, latest kept backtest, actions: backtest on a listing via the panel, ask the agent to change, files, allow/revoke, move to Trash) plus a detail page `#/strategies/<name>` (files, notes, allowed versions, backtests across listings, "use live" drafts a scheduled-task request) in the first version; deleting moves to Trash, the user's only (no agent tool); "changed since allowed" shown only on the strategies page, no title-bar badge, nothing in Today. Devices read and backtest; allow/revoke/delete stay with the computer. Stacked on #338.

**Strategies page built 2026-10-27** as stack #340 (trash via Host.trashItem → shell.trashItem, reveal, runtimes for windows, approvals in catalog, strategiesLink + AppLinks.strategy) → #341 (webapp /strategies + /strategies/$name, title-bar StrategyIcon, agent screen kind Strategies) → #342 (docs), on top of #338, all merged since. Smoke-run seen end to end; two test folders (broken, close-mean) left in the user's Finder Trash since the terminal can't reach ~/.Trash.

**Why:** if the user returns to this, start from these proposals and ask for the open decisions instead of re-deriving the design.

**How to apply:** the runtime is the user's own (decided); the stacks #327 → #333, #335 → #338 and #340 → #342 are built and merged, so start from what is unseen or unmeasured above. Windows still has no sandbox (Linear CHI-30), so option B governs it. Related: [[solyx-backtest-panel]], [[solyx-rust-napi-evaluation]], [[solyx-rolling-backtests]].

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-python-strategies.md`, type `project`).
