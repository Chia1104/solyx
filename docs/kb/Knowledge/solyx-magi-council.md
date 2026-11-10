---
type: fact
title: MAGI decision mode in solyx — three persona units vote on forecasts and order proposals; decisions the user made and what is left unbuilt
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

# MAGI decision mode in solyx — three persona units vote on forecasts and order proposals; decisions the user made and what is left unbuilt

A "for fun" feature the user asked for on 2026-10-07, modelled on the MAGI of Neon Genesis Evangelion. Merged into main as PR #13 on 2026-10-07, stacked on PR #12 (see [[solyx-research-forecast-design]]).

Decisions the user made:

- Persona theatre on a general LLM, not on the decisions models (I advised that decisions models cannot role-play or give reasons).
- A "decision mode" setting (`agent.decisionMode`: single or magi).
- Both forecasts and order proposals go to the vote.
- Personas follow my mapping: Melchior the scientist (data and evidence), Balthasar the mother (protect capital), Casper the woman (desire, crowd mood, cost of standing aside).

How it works: the vote ratifies a motion (approve or reject, two of three carry), it does not pick a direction; a rejected motion keeps nothing; the vote comes before `propose` and never replaces the user's confirmation.

A model per unit (`agent.magi`) was added in PR #15 on 2026-10-07, along with a charter change so Balthasar no longer approves a neutral forecast for risking nothing. Still not built: a hard cap on revised motions after a rejected forecast (only the prompt limits it to one) (Linear CHI-38).

Seen in the user's first three MAGI runs (GPT, 2026-10-07): the personas read distinctly, and Melchior dissented once; but every forecast was neutral with no plan, and Balthasar approved each partly because a neutral forecast risks no capital, which rewards not taking a side.

**Why:** the user wants the performance of three personas deliberating; accuracy is secondary, though the track record tells forecasts a vote carried from the rest.

**How to apply:** keep red and green out of the panel (they belong to price direction in this app); do not move safety judgements (shell commands, claim audit) to the vote.

## 2026-10-13: a vote on each scenario

The user saw that every forecast came out neutral (10 of 10 in their local research database, none with a plan, 2 of them not voted on) and asked whether the MAGI should judge each scenario instead. Two things they said that bind later work:

- The MAGI has to stay a vote, as in Evangelion. I first proposed having each unit give its own probabilities, and they pushed back: "這樣是不是就不是做表決了". Do not turn the units into estimators.
- They approved my revised direction ("這建議方向我覺得的可以"): each scenario is its own motion, that the close is more likely to land in its band than the listing's history says; the forecast is kept however the vote goes, with the counts beside it; an order stays one motion with a veto.

Built as #122 (`feat/forecast-lean`: a direction is the lean from base rates and needs no plan) → #123 (`feat/magi-scenario-motions`), stacked on 2026-10-13 and merged since. My own picks, not put to them: the units are not shown the agent's probabilities, direction or plan; a listing without base rates gets no vote (I had said I leaned to keeping the whole-forecast vote there, then dropped it to keep one path); a migration removes the old whole-forecast votes from kept forecasts; the record counts carried scenarios against history's expectation, with no record per unit.

Jev's part, which the user approved on 2026-10-13 ("ok 先照這方向看看"), is #125 (`feat/forecast-evidence-reading`), stacked on #123 and merged since: a decisions model reads each fact a forecast cites, alone, for how it bears on the share price; the mean is kept with the forecast, shown to the units and on the card, and the record counts the side the facts read towards against history. It decides nothing. I had recommended against asking Jev for band probabilities directly (TypeSafe's own notes list jev-1.13 as weak on numeric precision, date comparison and indirection). This loosens the 2026-10-07 decision that decisions models audit claims and never predict prices. My picks: the 0.25 line under which facts call no side, and that the agent sees the reading only after the forecast is kept. Measured on jev-1.13.0 with `scripts/eval-facts.ts`: 10/10 good, 10/10 bad, 10/10 neutral synthetic facts on their side of the line. Not measured on Cloudflare's or OpenAI's models.

The user ran a real 3231 forecast on #122 + #123 on 2026-10-13 (their dev app runs from the checkout, so it runs whatever branch I leave checked out, and its migrations reach their real database). It kept a long forecast with no plan on the first try, and the three units, all on gpt-6-astra, voted 1–2, 0–3, 1–2: Balthasar alone backed the fall, Casper alone the rise, Melchior rejected all three for want of proof, so nothing carried. Melchior is the swing vote, which makes the council slow to carry anything. Not raised with the user as a problem yet.

## 2026-10-13: the display

The user sent a frame of the series' MAGI screen and asked for the panel to follow the original ("參考『新世紀福音戰士』原作效果做整合"). Built as PR #158 (`feat/magi-board`, merged) in `magi-panel.tsx`: the three units in the original's layout with bevelled corners (`corner-shape: bevel`) and links between them, 提訴 on the left and 決議 on the right in a heavy Mincho, and a unit's cell split into one band per motion so a forecast's scenarios share one board. I put three picks to them with screenshots and they accepted the result as shown ("ok 這樣就行了", 2026-10-13): ink and hatching kept instead of the original's blue, red and orange, since the renderer keeps red and green for prices; no 審議中 state, which would need the agent to say when a vote starts; an order's board says only 下單建議, since the panel is handed the vote alone. They did not ask for either of the last two to be built. Unit votes read 否定 in zh-TW (the outcome stays 否決).

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-magi-council.md`, type `project`).
