---
type: fact
title: "Automatic backup (PR #179: Windows restore fix, migrations by name) of Solyx's databases and config to the user's own S3 bucket — built 2026-10-13 as stack #159 → #160 → #161 → #163; the user's decisions, what the design became, how it was measured, what is unverified"
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

# Automatic backup (PR #179: Windows restore fix, migrations by name) of Solyx's databases and config to the user's own S3 bucket — built 2026-10-13 as stack #159 → #160 → #161 → #163; the user's decisions, what the design became, how it was measured, what is unverified

On 2026-10-13 the user asked me to evaluate an automatic backup to an S3 bucket they configure, pointing at magpie (`/Users/chia1104/Documents/GitHub/magpie`, `internal/davsync` and `internal/backup`) as a reference, then said to go ahead in the direction I had set ("就先照你訂的方向調吧"). Built the same day as four stacked PRs, open and unmerged when I stopped: #159 `feat/backup-bundle` (packages) → #160 `feat/backup-restore` (desktop tab, backup and restore) → #161 `feat/backup-schedule` (schedule and thinning) → #163 `feat/backup-thread` (the work in a worker thread).

**The user's decisions (2026-10-13):**

- Backup only, no sync between computers.
- Secrets (`secrets.json`) stay out of the backup; keys are entered again after a restore.
- A lost passphrase means no restore, and that is accepted.
- Backups run often and the user sets how often.
- They did not answer whether four weeks of history is enough; they only said to go with my direction, so that depth is my pick.

**What the design became, where it differs from what I first told them:**

- A backup is one object (a gzipped tar sealed with scrypt and AES-256-GCM), not a file per database with a manifest, since the folders (skills, conversations' workspaces) needed an archive anyway and one object makes deleting atomic.
- Backups are found by S3's listing (XML, through `fast-xml-parser`), not by a JSON index at a fixed key, since a new computer could not find another installation's index and a shared one would need conditional writes.
- Keys are `<folder>/<installation>/<YYYYMMDDTHHMMSSZ>.solyx-backup`, the folder the kebab app name by default.
- Retention is restic's rule: newest 4, then the last of each of 24 hours, 7 days and 4 weeks that hold a backup. With one backup a day the hourly rule keeps 24 days of them, since each sits in an hour of its own; the total stays at 39 at most.
- `backup.automatic` is on by default once the destination is set up (my pick, not asked).

**The worker thread (#163).** The user asked whether a restore has to run in the main process ("我們 restore 一定只能在 main process 運行嗎"), and said "ok" to moving the work out. Only two things must stay in main: decrypting the secrets (`safeStorage`) and the swap as the app starts. Measured in the built app on a 302 MB database of rows that do not compress: a backup held main's event loop 4.1 s of 6.4 s before (tar's gzip compresses on the calling thread) and 0.02 s after; a restore 0.41 s before and 0.15 s after, of which a plain quit is about 0.12 s. Each job runs in a thread of its own that ends with it. I did not trust `performance.eventLoopUtilization` in Electron's main process (my guess about how it polls libuv, not something I tested), so the measure was a 10 ms timer and how late it came, dumped on SIGUSR2 and on exit from the smoke wrapper.

**Codex review round (2026-10-14).** The user pasted Codex's reviews on #159–#161 as PR comments and asked whether anything needed changing ("你看看需不需要調整"). All four findings reproduced in tests and were fixed on their own branches, carried up by merging each branch into the next (no force push), CI green on all four:

- `readBundle` answered as whole when tar could not write a file. tar's `strict` fails while later files are still being written, which raced the cleanup, so the first `onwarn` is kept and thrown after the pipeline ends.
- A swap cut off during a cross-volume copy was taken for done. `move` copies to `<to>.restoring`, renames, and a destination that is there means only the source is left to remove. The realistic trigger is `~/.solyx` linked to another disk.
- A new passphrase or bucket got no backup until content changed. `backup.json` now names the location it counts, and a `secrets.onChange` listener forgets the digest; nothing derived from the passphrase is kept.
- The retry wait counted from the pass's start; it counts from the failure.

Found on the way, also fixed: a bundle packs no links (tar rewrites an absolute one and drops one that escapes), so a place that is itself a link is read through it with `realpath`, and a link inside a folder is left out; tar's default `maxDecompressionRatio` of 1000 refused a bundle of 32 MB of zeroes, lifted since the bundle is authenticated first. `collect` also read `ENOENT` from anywhere in a recursive copy as the place not being there, so a file removed mid-copy left the place partly copied; I raised it and the user said to throw and say files changed ("讓他丟個錯誤並提示說有檔案變動"), so the backup now fails naming the place.

**Verified in the built app against a fake S3 server on this computer:** backup, listing, restore with the swap at the next start, the waiting proposal dismissed, the scheduled backup a minute after start, thinning through signed DELETEs that left another installation's objects alone, and that an idle app's five database snapshots stay byte-identical across a scheduler tick.

**Unverified:** a real R2, B2, AWS or MinIO bucket; Windows; the dialog a failed swap shows; whether an older `agent.sqlite` opens after pi-durable's schema moves.

**Found on the way:** the order desk's `onChange` reached `tray` before it was built, so a submission cut off by an exit would have stopped the app from starting; #159 has the desk tell no one of what it settles as it opens.

**Windows restore (2026-10-15).** A Mac backup failed to restore on Windows on the same version with "user.sqlite was written by a newer Solyx". `verifySnapshot` matched `__drizzle_migrations` by hash; drizzle hashes raw `migration.sql`, there is no `.gitattributes`, and the windows-2025 runner checks out CRLF. Fixed in PR #179 (`fix/restore-across-platforms`) by matching on `name`, as drizzle's `getMigrationsToRun` does. The swap at start (`takeRestore`, plain `renameSync`) is still unverified on Windows, where an open handle (e.g. Defender scanning freshly unpacked files) makes rename fail with EPERM/EBUSY.

**Cross-computer sync (2026-10-15).** The user first asked for sync, picked the handoff model I proposed (one computer active at a time, others standby, pull whole snapshots, keep the losing side as a backup on divergence), then interrupted: the real need was the Windows restore. Sync is not commissioned; the reasons against row-level merging are integer ids, pi-durable's schema, and the paper account and proposals as a ledger. Even today, restoring A onto B leaves both running the same scheduled tasks.

**How to apply:** start from the PRs rather than redesigning; the jobs are in `backup-jobs.ts` and run in-process in tests through `createBackupJobs(() => bucket)`, while `tests/backup-threads.test.ts` starts the real TypeScript entry in a thread; the smoke test needs `packages/backup/tests/fixtures/fake-s3.ts` run from a plain node script, with older backups seeded through `createBucket` to see thinning. Related: [[solyx-scheduled-work]], [[solyx-isolated-smoke-run]], [[solyx-stacked-pr-merges]].

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-s3-backup.md`, type `project`).
