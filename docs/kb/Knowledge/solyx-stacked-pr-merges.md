---
type: fact
title: Stacked PRs in solyx land in stale parent branches unless retargeted to develop before merging; how to prevent and recover
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

# Stacked PRs in solyx land in stale parent branches unless retargeted to develop before merging; how to prevent and recover

On 2026-10-09 the user merged a stack (#40 → #41/#43 → #44) one after another. #43 and #44 squashed into their already-merged parent branches (`feat/desktop-eva-palettes`, `feat/desktop-onboarding-palette`) and never reached `develop`; they were recovered by cherry-picking each squash onto `develop` as #45 and #46.

**Why:** the repo has `delete_branch_on_merge: false`, so GitHub never retargets a dependent PR when its base merges, and the user squash-merges.

**How to apply:** when opening stacked PRs, say plainly that after each base merges the next PR must be retargeted (`gh pr edit N --base develop`, then rebase onto `develop`) before merging, or offer to do it; prefer unstacked PRs from `develop` when the changes don't depend on each other. If it happens again, check each merge commit with `git branch -r --contains`, then cherry-pick the stranded squash onto a branch from `develop`. Related: [[solyx-commit-to-main]].

On 2026-10-09 the stack #58→#59→#61 was merged within two seconds without retargeting, and all three squashes still landed on `develop` in order (`111e1a4`, `bc2b8b8`, `9bb506e`), while GitHub kept listing #59 and #61 against their parent branches. So judge a stack by `git branch -r --contains <merge sha>` and by diffing `develop` against the top branch, not by the PR's `baseRefName`.

Unstacked PRs still conflict when each edits a neighbouring bullet of one `AGENTS.md`: on 2026-10-13 two branches from `develop` changed the `./themes` and `./tasks` lines of `packages/agent/AGENTS.md`, which sit one after the other, and would not merge together. Before opening several PRs at once, merge their branches into a throwaway branch (which the smoke run needs anyway); stack only the pair that conflicts and say in its body that the code does not depend on its parent. An aborted test merge can fail with "Entry … not uptodate" after `vp check` touched files: `git update-index -q --refresh`, then `git merge --abort`.

GitHub native stacks (seen 2026-10-23): opening a PR whose base is another open PR's head branch put both PRs into a native stack, numbered like a PR (stack #288 held #285 → #286 → #289). Closing the bottom PR then left the others unable to change base ("Cannot change the base branch because the pull request is part of a stack"). No public API removes a PR from a stack; the `gh-stack` extension is not installed. The fix was to close each stuck PR and reopen it from the same branch (#290, #291). The reopened pair did not form a stack. To avoid this, retarget a PR before closing the one beneath it.

2026-10-28: the user rebased the US stack #356 → #361 onto develop themselves (after merging #363) and force-pushed linear branches, which dropped the merge commits I had used to carry a lower PR's fix up the stack; #362 then conflicted. Fixed by rebuilding #362 as one commit: `git diff <old #361 tip> <old #362 tip>` applied with `git apply --3way` on the new #361, after checking the new #361 differed from the old only by #363. To keep stacks rebase-friendly, carry a lower fix up by rebasing the upper branches rather than merging.

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-stacked-pr-merges.md`, type `project`).
