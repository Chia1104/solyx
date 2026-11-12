---
type: decision
title: A Longbridge packet that does not read is left out and reported
status: active
author: agent
confidence: medium
created: 2026-11-13
updated: 2026-11-13
verified_commit: c9814209
code_refs:
  - packages/longbridge/src/client.ts#createLongbridge
  - packages/longbridge/src/client.ts#UnreadablePacket
tags:
  - longbridge
  - crash
approved_at: 2026-11-13
approved_by: auto-approve
---

# A Longbridge packet that does not read is left out and reported

Decided 2026-11-13, built as PR #393 (Linear CHI-83). How the crash was read is in [[solyx-nightly-crash-diagnosis]].

## Context

Solyx Nightly 0.0.1-nightly.20261030.143 quit on 2026-11-12 at 16:30:39 UTC, in the US regular session, after running since 2026-11-09. Longbridge's quote server pushed one trade message that was not valid protobuf. `decodeTradePush` threw `illegal tag` inside the quote socket's `message` listener, nothing caught it, and the uncaught exception ended the backend.

Why that push did not read is unknown. The crash record keeps no message and Sentry held no event from the backend. Ruled out on 2026-11-13: the header's flags and the body's length are read as Longbridge's own SDK reads them (`rust/crates/wsclient/src/codec.rs` in `longbridge/openapi`), so it was not a gzip body read as plain. Trade pushes had read for three and a half days before it, so it was one odd packet, not every push.

## Decision

- The listener catches. A packet that does not read, or that a push listener cannot take, is left out and the connection carries on.
- The client tells its owner through `onUnreadable`, and the backend sends it to `diagnostics.report` as `longbridge.unreadable`, with the packet's command and size.
- A refusal is read before its request stops waiting. Otherwise one that does not read would leave the request waiting for ever once the listener catches.

## Alternatives considered

- **Drop the connection and open another.** The stream would start every watch again from its bars, so no sale would be missing. Rejected because a server that keeps sending such packets would turn it into a reconnect loop. Longbridge's SDK also skips: it logs `failed to parse push message` and continues.
- **`diagnostics.recovered` instead of `report`.** A recovered failure keeps only its type, and with no OTLP endpoint set it reaches nothing but the terminal. A report reaches Sentry with the message, which names the bad tag. The catch also covers a fault of a listener's own, which nothing should cause.
- **Log the packet's first bytes.** Rejected: `diagnostics` logs identifiers only, and an answer's bytes could hold what the sign-in returned.

## Consequences

- A trade push left out is missing from its minute's bar until the chart loads the session again.
- A fault in a push listener no longer ends the backend. It shows up as a `longbridge.unreadable` report.
- If Longbridge sends many such packets, each is reported.
- When a `longbridge.unreadable` report arrives, read its message first. `illegal tag: field no N wire type M` gives the first bad tag, and with the command and size it says whether the decoder in `packages/longbridge/src/wire.ts` misses a packet form or the server sent noise.
