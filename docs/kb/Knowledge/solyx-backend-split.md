---
type: fact
title: 2026-10-23 agreed direction for splitting the desktop backend out (utility process, Host port, Hono edge, self-host server without Fubon); TUI and mobile are future only
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

# 2026-10-23 agreed direction for splitting the desktop backend out (utility process, Host port, Hono edge, self-host server without Fubon); TUI and mobile are future only

Agreed with the user on 2026-10-23 ("先照建議的繼續吧"):

- One backend per dataset, every client connects to it. Code lives in `packages/backend` with one entry `startBackend(host)` / `createServices(host)`; contracts move to `packages/api`; renderer moves to `apps/web` with a selectable transport.
- On desktop the backend runs in an Electron **utilityProcess**, not main and not an `ELECTRON_RUN_AS_NODE` child (that fuse is off since #284, unlike t3code which spawns its server that way). Main stays thin (windows, tray, dialog, updater, Sentry) and injects what only Electron has (`safeStorage`, `powerMonitor`, `relaunch`, forking the Fubon utility process) through a host port (`host.contract.ts`, the `fubon.contract.ts` pattern).
- Hono is only the HTTP edge (Host/Origin checks against DNS rebinding, pairing, `/rpc` via oRPC fetch handler, `/ws` via oRPC websocket adapter, static web); procedures stay oRPC. Authorization lives in oRPC middleware since MessagePort, HTTP and WebSocket all reach the same router. Remote confirm needs a per-action passkey signature over proposal id + price; edge off by default, loopback only; SSH/Tailscale are the user's ways in, no relay.
- Fubon stays on the desktop host only (cert + password + ID never leave the user's computer); `apps/server` (plain Node, passphrase unlock, lockfile) trades paper only and refuses `trading.broker: fubon` at start. Fubon's Node SDK does support Linux, so this is a choice, not a limit.
- TUI and mobile are future only: no unix socket, no `@solyx/client`, no mobile device keys yet.
- PR order: 1 backend into utility process (Host port, `sender`→`client`, appearance as events, Node AIA fetch replaces `chromiumFetch`, lint electron imports) → 2 `packages/api` → 3 `packages/backend` → 4 `apps/web` → 5 Hono edge + pairing + auth → 6 `apps/server` → 7 optional desktop-over-SSH (t3code `packages/ssh` pattern).
- To verify before step 1: inspector fuses hold in a utility process (SIGUSR1, execArgv `--inspect`), `@sentry/electron` reports from one, worker threads start in one.

**Why:** the backend can place orders, so the process holding decrypted secrets must stay inside the fused, signed Electron binary; t3code's layout is the model for the rest.

**How to apply:** follow this order; update AGENTS.md runtime boundaries and invariants 1, 3, 4, 5, 6 as each seam changes. Related: [[solyx-live-trading-plan]], [[solyx-orpc-migration]], [[solyx-isolated-smoke-run]].

## Progress (2026-10-23)

Step 1 is built and open, unmerged:

- #290 `refactor(desktop)`: the `Host` port. Includes `chromiumFetch` as a Host member, still main's in-memory session there; `client: { window }` replaces `sender`.
- #291 `refactor(desktop)`: the backend in a utility process, stacked on #290. Code moved to `src/backend`. Contracts are `utility/host.contract.ts` and `utility/backend.contract.ts`. Main forks Fubon and hands its port over. `chromiumFetch` is Electron's `net.fetch` in the utility process (`credentials: "omit"`, `cache: "no-store"`). Retarget it to develop after #290 merges.
- #287 is separate, from develop: `tracePropagationTargets: []`.
- Closed:
  - #285, a home-made AIA chain completion over undici. The user does not want our own chain-fetch code; the statistics portal stays on Chromium's stack (it still omits its intermediate, so Node's fetch fails).
  - #286 and #289, replaced by #290 and #291 because they were stuck in GitHub's native stack #288 (see [[solyx-stacked-pr-merges]]).
- Open question for step 6 (`apps/server`, plain Node): there is no Chromium there, so the statistics portal needs a decision then.

Probe results:

- In the packaged test build, a utility process refused `--inspect` and `NODE_OPTIONS`, and SIGUSR1 killed it. Unfused Electron opened the inspector in both cases.
- Worker threads from asar ran in a utility process.
- `@sentry/electron/utility` events passed through main's `beforeSend` and its consent gate.
- `net.fetch` in a utility process completed the chain (`incomplete-chain.badssl.com` gave 200) and refused a self-signed certificate.

Smoke technique: a stand-in Fubon SDK (`trade.js` with a CoreSdk Proxy and one stock account) exercised the fork and port handoff without an account.

Later on 2026-10-23 the user asked for the remaining steps as one stack ("github 那邊我可以 stack 在一起 merge"). Built and open, unmerged:

- #293 `packages/api` → #294 `packages/backend` → #295 `apps/web` → #296 step 5a, edge + pairing.
- #296 details:
  - Devices are default-deny. A contract opens a procedure with `.meta(forDevices(true))`, and a client interceptor refuses the rest with FORBIDDEN.
  - The device token is stored only as a SHA-256, sealed under the secret `paired-devices`. The WebSocket token rides in the subprotocol; close code 4401 means unpaired.
  - A security hook flagged that a device could create a session in bypass. Fixed in the route: a device creates only `ask` sessions, and its `send` to a bypass session is refused. Auto stays allowed, matching the scheduled runs' "never bypass" line.
  - Left in the PR for the user: a device can prompt the agent, and the trading mandate may then send that proposal.
- #297 (5b, stacked on #296) is built and open: passkey per-action signing.
  - A passkey is added only within 5 minutes of pairing and is bound to `localhost`.
  - `devices.actionOptions` gives a challenge for one {kind, id}, lasting 2 minutes and usable once. `…Signed` procedures verify the signature before the desk is reached.
  - It changes trading invariant 1; the user reviews that in the PR.
  - Agent approvals remain computer-only.
  - A smoke run with a CDP virtual authenticator (`WebAuthn.addVirtualAuthenticator` on the agent-browser session's page target) submitted a paper order from the browser.
  - `vp dedupe` was needed: two copies of `@peculiar/asn1-schema` broke the ECDSA verification.
- 2026-10-23: at the user's request, `apps/web` was renamed to `apps/webapp` (`@solyx/webapp`) in #295 (retitled) and merged up into #296 and #297. Directory rename detection left files in new subfolders at the old path; they were moved by hand.
- Step 6 (`apps/server`) paused for the user, 2026-10-23. A headless server has no "window of this computer", and today devices can't change settings, save secrets or answer the agent, so the server would be unconfigurable. Options I put to the user:
  - A (my recommendation): the console prints an owner code; the browser that pairs with it gets a window's rights, and its passkey still signs orders. Other browsers are devices.
  - B: every browser is a device; configuration goes through CLI subcommands.
  - C: every browser is the owner.
  - Also asked: the statistics portal on plain fetch plus the operator's `NODE_EXTRA_CA_CERTS`. Passphrase from a TTY prompt or `--passphrase-file`.
- 2026-10-23: the user merged #290–#297 into develop. #287 was conflicted with develop (crash-reports moved to `main/shell/`, the rule moved to `packages/backend/AGENTS.md`). I merged develop into its branch, with no force push, and the net diff is 3 code lines plus 1 sentence.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-backend-split.md`, type `project`).
