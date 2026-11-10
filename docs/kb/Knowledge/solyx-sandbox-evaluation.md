---
type: fact
title: "2026-10-25 SPACE ruled out; sandbox-runtime probed (macOS, Electron utility process, Linux Docker) and built as PR #326 (macOS-only shell sandbox); gotchas found while building"
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

# 2026-10-25 SPACE ruled out; sandbox-runtime probed (macOS, Electron utility process, Linux Docker) and built as PR #326 (macOS-only shell sandbox); gotchas found while building

On 2026-10-25 the user asked whether perplexityai/SPACE or anthropics/sandbox-runtime could sandbox the agent. They then asked for a spike, then said "直接幫我進去吧": built as PR #326 (branch `feat/shell-sandbox`), open as of 2026-10-25.

**SPACE: ruled out.** It runs Firecracker on Kubernetes and needs a Linux x86_64 host with KVM, Docker running privileged containers, and Kind. It does not run on macOS. Using it would mean a cloud service or a cluster the user runs, which conflicts with invariant 5 (no relay server).

**sandbox-runtime (`@anthropic-ai/sandbox-runtime` 0.0.81): probed.** The probe kit is in /tmp/srtprobe (`scripts/probe.mjs`, `electron-main.cjs`, `linux-run.sh`). Each check runs once unsandboxed as a baseline and once sandboxed.

- **macOS, config `denyRead: [home, userData]`, `allowRead`/`allowWrite: [workspace]`, no domains.** Every check passed, both from Node 22 and inside an Electron 45 `utilityProcess`. These were all blocked:
  - reading the sealed secrets and another conversation's folder
  - listing the real userData and reading the real config
  - writes outside the workspace
  - curl, raw TCP and urllib
  - DNS
  - loopback to a local server, which stands in for the edge, Ollama and Fubon
  - signalling the parent process
  - Keychain
  - the clipboard

  A Python strategy ran in the workspace. Wrapping adds about 15 ms per command.

- **Keychain gap.** srt's Seatbelt profile allows `com.apple.securityd.xpc`. When only Solyx's own paths were denied, a sandboxed `security find-generic-password` read an any-app-ACL probe item. Only denying `~/Library/Keychains`, which happens when the whole home is denied, blocks it. So deny the home and re-allow paths, never deny only Solyx's paths.
- **Interpreters under the home.** Denying the home blocks interpreters installed there, such as uv, pyenv or conda. Re-allowing the interpreter's folder works (uv's Python ran). A symlink's own folder must be allowed too.
- **ripgrep.** The code says it is used only on Linux. The README is wrong that macOS needs it.
- **Linux (Docker, Debian 12, bwrap 0.8, OrbStack kernel).** It needed `--security-opt systempaths=unconfined`; otherwise bwrap cannot mount /proc. These were blocked:
  - libsecret over D-Bus (seccomp: "Unable to create socket")
  - the parent's /proc, hidden by the PID namespace
  - network, DNS and loopback

  A read-denied home becomes a tmpfs, so writes there "succeed" but never reach the host. The Ubuntu 24.04 AppArmor userns restriction was not tested.

- **Not tested:** Windows (no VM here), a packaged signed build, and the real Solyx Safe Storage item. The last was left alone on purpose, because reading it prompts the user.

Integration path: in `packages/agent/src/shell.ts`, set `execution.command = await SandboxManager.wrapWithSandbox(execution.command)` inside `createBashTool({ prepare })`. pi-durable runs the command `prepare` rewrote.

**Why:** these are the facts behind any decision to sandbox the shell or Python strategies, or to lift the paper-only shell rule.

**How to apply:** build from the deny-home config. Before relaxing the live-account rule, test Windows. Related: [[solyx-python-strategies]].

**What PR #326 built.** These were my picks; the user asked for none of them:

- The sandbox is macOS only. Windows stays unsandboxed, and Linux is not shipped.
- The paper-only rule is kept everywhere. Lifting it is still the user's call.
- `packages/agent/src/sandbox.ts` holds the policy and is exported for the settings route's `SANDBOXED`.
- A command's HOME is its workspace, and its TMPDIR is `<workspace>/.tmp`.
- Readable folders are the workspace, the offered skills' folders and the PATH folders under the home plus their symlink targets, where a target in `bin/` opens its parent.
- These are denied: the home, the app folders, the Keychains, the per-user temp folder (`getconf DARWIN_USER_TEMP_DIR`), `/Volumes` and `/tmp/claude`.
- There is no network.
- The new `shellSandboxed` field in the AgentSkills contract picks the settings copy.

**Gotchas found while building:**

- Seatbelt matches the path as the command spelled it. Denying `/tmp` blocks `/tmp/...` paths that srt only re-allows as `/private/tmp/...`, so never deny a symlinked prefix.
- Compare realpaths before excluding folders. Otherwise a link can reopen app folders under another spelling of the path.
- An allowRead entry lifts every deny beneath it.
- srt's TMPDIR is hard-coded to `/tmp/claude`, which is shared with Claude Code.
- macOS `mktemp` ignores TMPDIR.
- The `/usr/bin` CLT shims warn about the xcrun cache. Never allow writing `xcrun_db`: that would let a command choose what the user's own git runs.
- Using `spawnSync` in a probe blocks srt's in-process proxy, so blocked requests seem to hang. Use an async spawn.
- `vp run` unsets TMPDIR, so tests use /tmp there.

**Windows probe, 2026-10-25.** Branch `probe/windows-sandbox` on origin holds a workflow and `probe/windows-sandbox.mjs`. It ran seven times on windows-2025 with srt 0.0.81, x64, as an elevated runner.

- **API differences from macOS:**
  - `windows.srtWin.path` is required: `resolveSrtWin({ path: VENDORED_SRT_WIN_EXE })`. srt advises shipping it outside any write grant.
  - `wrapWithSandbox` throws on Windows. Use `wrapWithSandboxArgv`, then spawn with `shell: false`. So pi-durable's string-rewriting `prepare` cannot be used; it needs a custom exec.
  - A command cannot add its own `allowRead`/`allowWrite`; only the session can. The design is a session write root over the whole workspaces folder, with per-command `denyRead`/`denyWrite` on sibling conversations, which works.
- **Install and uninstall:** install takes 0.4 s (no UAC on the runner) and creates the `srt-sandbox` user, the group and 4 WFP filters. Uninstall takes 2–5 s and removes the user, the group, the WFP filters and the ACEs.
- **Timing:**
  - The first `initialize` takes 18–67 s, because the account's first logon creates `C:\Users\srt-sandbox` (confirmed: absent before, present after). Later initializations take 0.1–2.6 s.
  - Each command costs +140–440 ms.
- **Isolation, with `skipProfileGrant`:**
  - The profile is unreadable by default, so the app folders need no deny.
  - Denied: Documents, `.ssh`, the user's HKCU, DPAPI Unprotect ("Key not valid"), stopping the user's processes, writes outside the root (profile, ProgramData, Public, `C:\`), the sibling conversation, TCP out and loopback through WFP, and HTTP through the proxy (403).
  - The environment does not leak.
- **Gaps:**
  - DNS resolves inside, through the system service; srt lists this as a known limitation.
  - Windows PowerShell cannot `Set-Location` into the workspace when its ancestors are unreadable by the sandbox account. The process also starts in `C:\`, and a PowerShell launched from cmd after `cd /d` still lands in `C:\`. But cmd `cd` and .NET `SetCurrentDirectory` work, and absolute paths read and write fine.
  - With a `denyRead` above the root it is worse.
  - Bare `pwsh` was not found by srt-win (it needs an absolute path).
  - The profile grant refuses allows inside excluded paths.
- **Run 8, PowerShell fixes.** Root cause: PowerShell 5.1 and 7 both normalize a path by listing every folder above it, and pwsh names the folder ("Access to the path '...\\AppData' is denied"). cmd and .NET do not list, which is why they work. srt-win falls back to a `C:\\` start for the same reason. Results:
  - **PSDrive** (`New-PSDrive W -Root <ws>; Set-Location W:\\`): works, and native children get the real cwd. But the process still starts in `C:\\`, and `W:\\` paths passed as native arguments break.
  - **pwsh 7 by absolute path:** fails the same way.
  - **Non-inheriting `(RD,RA,X,S)` ACE for `sandbox-runtime-users` on each folder above:** everything works in 5.1 and 7, start location included. The cost is that every srt sandbox on the machine can list names in the profile root, AppData, Roaming and the app folder.
  - **Junction from ProgramData to the workspace:** everything works. The data stays in userData.
  - **Workspace placed directly under ProgramData:** everything works.
- **Run 8, encoding.** CJK prints as `??` in both 5.1 and 7 unless `[Console]::OutputEncoding` is UTF-8. In 5.1, `>` writes UTF-16LE with a BOM.
- **My recommendation to the user:** a junction per conversation under a per-user ProgramData folder, plus a fixed PowerShell preamble covering UTF-8, ErrorAction, ProgressPreference, default encoding and the exit code.

**User's decision, 2026-10-25.** Windows gets no sandbox for now. The sandbox becomes a user switch `agent.shellSandbox`: on by default for macOS and Linux. On Windows the switch is disabled and says "not available yet"; scripts still run, through ask or the decisions model in auto. This was built into PR #326 as a second commit, b90e60b3:

- Linux uses bubblewrap and seccomp.
- `sandboxProblems()` refuses commands rather than fall back. A missing seccomp filter counts as a problem, and so does a failing bwrap user-namespace smoke test.
- The settings row is the `ShellSandboxRow` component, with API type `ShellSandbox`, set through `setAgentShellSandbox`.
- The desktop build copies srt's `vendor/seccomp` beside the backend bundle on Linux builds only.
- Verified on Linux in Docker by copying `sandbox.ts` to `/tmp`, since OrbStack cannot mount `~/Documents` (TCC).

**Later fixes in #326:**

- **b1f4f7be:** denials are no longer filtered by whether their path exists. Seatbelt allows writes to srt's `/tmp/claude` by path, so a missing `/tmp/claude` could be created and written.
- **efe3ec38**, answering Strix's two LOW findings:
  - `/tmp` and `/var/tmp` are now denied on both OSes by their real paths. Denying macOS's `/tmp` link would break allowed paths spelled through it.
  - On Linux the `/tmp` deny also hides srt's proxy sockets (`tmpdir()/claude-http-*.sock`). With no host allowed, only the error changes. Allowing a domain later would need those sockets rebound.
  - The approval card is sandbox-aware again through `useShellDescription`, which reads the skills settings query in windows only. Elsewhere it shows the unsandboxed warning.

The user said to keep srt rather than Gondolin (microVM; needs QEMU, a ~200MB image from GitHub, no Windows) for now.

- **dd72e5e5:**
  - Skill folders are now held to the system's denials too, through `Bounds.system`.
  - The approval card shows the unsandboxed warning while its query refetches.
  - The verified srt rule: a read grant lifts a denial on that same path but keeps denials deeper inside it. So the containment check only matters for an exact match, and a test has to link to the denied path itself (a link to its parent proved nothing).
- **3428d1a9 (Strix's third finding):** on Linux srt binds its own write path `/tmp/claude` back over a `denyRead` tmpfs, so the read denial did not hold. The fix is a credential deny, `credentials.files: [{ path, mode: "deny" }]`, which srt applies after those binds. Reproduced and verified in Docker. macOS was never affected, since Seatbelt honours the read denial.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-sandbox-evaluation.md`, type `project`).
