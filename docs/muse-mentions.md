# Mention-gated Meta Muse / North participation

The adapter watches the [scoped thread gateway](thread-gateway.md) locally or
over your tailnet. It does not require Muse to log into Delta. Only your host
gateway uses your Delta account; the adapter uses a revocable per-agent token.

It reuses the existing `north-message` executable from
`Work/work/devices/omair/muse-chat/`. It does not patch/restart that service,
change pairing, install a daemon, or transfer Muse/Delta credentials.

## What summons Muse

- A **new** finalized owner-authored user message containing `@North` or `@Muse`.
- A **new** owner-authored native inline comment containing one of those names,
  when the referenced message/chain context is available.
- Mentions are case-insensitive, with boundaries; an address like
  `somebody@north.example` is not a summons.

Old replayed mentions, unmentioned events, other users, built-in agent comments,
unfinished assistant output and notes beginning `[Gateway bot:` are ignored.
The adapter makes **zero Muse calls** for those events. It maintains only bounded
local context until summoned: up to 100 item excerpts and 200 comment references.
On a summons, Muse receives the owner's mention plus a small referenced-item
excerpt and optional quoted span, not a whole transcript dump.

Muse is asked to reply in plain text only, not execute commands, modify files,
or change accounts. That instruction is not a sandbox for Muse's existing
capabilities. Only use the adapter with trusted gateway/native authorship.

## Owner setup

First grant an agent named `north` comment access to the selected thread:

```sh
deltadb gateway grant \
  --config ~/.local/state/deltadb-bots/capabilities.json \
  --thread THREAD_ID --agent north \
  --token-out ~/.local/state/deltadb-bots/north.token --comment
```

Run the gateway with `--apply` only when you intend bot notes to be posted.
Identify your Delta user ID from the authorized thread's own watch author field;
do not guess it from a display name. That ID is a required trigger allowlist.

Preview mode reads events but calls neither Muse nor the comment write endpoint:

```sh
deltadb muse listen \
  --url http://localhost --socket ~/.local/state/deltadb-bots/gateway.sock \
  --token-file ~/.local/state/deltadb-bots/north.token \
  --owner-user-id YOUR_DELTA_USER_ID \
  --bridge /absolute/path/to/north-message \
  --state ~/.local/state/deltadb-bots/muse-state --once
```

Add `--apply` to permit the actual round trip. `--once` exits after one matching
new mention (or preview); omit it for foreground ongoing participation. An
ongoing run can make multiple Muse requests—only as you add new matching
mentions. Use `--mentions North,Muse` to set the explicit name list.

For a remote adapter, omit `--socket`, use the gateway's tailnet HTTP origin
(or HTTPS), and provision only its scoped gateway token. The adapter device must
have its own approved route to a working `north-message` bridge. This prototype
invokes the local bridge path; it does not automatically choose SSH hosts or
bootstrap the Muse stream. Running it on Tom's already-paired host is simplest.

## Visible reply and recovery

The flow is:

```text
owner @North mention → local filter → north-message → Muse reply
    → scoped gateway → [Gateway bot: north] contextual note in the same thread
```

The reply is a **timeline note**, not a native inline comment bubble/reply chain.
It includes the target item ID and, for a native comment summons, the source
comment ID. Writing native inline annotations remains unverified.

Each source mention has a stable request ID and private on-disk state. The
adapter fsyncs intent before sending to Muse, stores a private recovery copy of
the reply before posting, and records the gateway result after confirmation.
It never automatically resends an ambiguous Muse delivery or regenerates a lost
reply. Pending state stops processing until reconciled by the owner. Do not
delete the state or change routes to force a retry.

The bridge's “delivered” state and “complete reply” are different. A send can be
accepted yet return no text or disconnect; that is not permission to resend.
Stale locks after a crash require confirming the old process is gone and
reconciling its pending request. Do not auto-steal locks.

On native/gateway disconnect, the adapter exits without automatic reconnect or
offline catch-up. A long Muse response may cause the bounded event stream to
drop a slow reader; context may also expire before posting. There is no durable
all-mentions-delivered guarantee. Reconnect skips replayed mentions intentionally;
after reconciliation, make a fresh mention if another response is needed.

An initial live waiting test timed out before any mention (no Muse call was
made). The gateway now emits idle heartbeats, and a local streamed heartbeat
was verified before re-arming the one-shot listener. This is a liveness fix,
not automatic recovery/retransmission of a Muse request.

Ctrl-C stops the adapter. No autostart or service installation is performed.
Runtime token/state files belong outside Git in private directories. Tests use
synthetic watch/comment events and a fake bridge; no actual Muse call is made
by `bun test`.

## Current live setup

For the authorized **testing 123** demonstration, the gateway and a one-mention
adapter were started on the same host. A gateway smoke-test note was recorded
and read back. After the owner mention entered the native event stream, the
adapter called the real Muse bridge once, saved the reply, and posted it into
the same thread. A native `recorded` receipt and read-only native watch read-back
confirmed `[Gateway bot: north]` with the source comment/item IDs. Muse did not
need a separate Delta login.

The first successful one-shot ended with a cleanup-only AbortError **after**
the receipt was saved; the note was already recorded. The one-shot now cancels
the live stream without pre-aborting its iterator, with a genuinely open-stream
fake-bridge regression test. No Muse request was resent to fix the exit status.
The one-shot has finished; no ongoing Muse adapter is silently installed or
started. The note-only test gateway was also stopped after verification and the
inline-only feature choice. Private grants/journals were retained for recovery;
no thread data or recorded notes were removed. These are foreground session
processes, not durable machine services.

During the live test Tom reported adding an `@North` comment, but native watch
still reported only the two earlier comments, with no mention, even after an
explicit scoped native sync succeeded. The exact thread link was confirmed.
A targeted, authorized read-only native `thread data` diagnostic then found the
mention in the comment set, with its ID in `comment_set.in_progress`. No Muse
request had been staged: the completed-event stream did not contain the draft.

The adapter does not scrape/send in-progress drafts to Muse. Finish/submit a
comment (or send a new owner message containing the mention) to exercise the
completed-event path. The debug data dump was diagnostic only, not an additional
event source or permission to forward raw thread state to Muse.

## Selected next feature: native draft-time annotations, not more timeline notes

Tom subsequently asked for replies **under in-progress comments before any new
LLM request**, and chose **true inline replies only** over an early timeline-note
fallback. Muse should also be able to start its own comments at chosen places.
Those native writes are not implemented by the current adapter. See the
[native annotation investigation](../research/native-annotations.md). The prior
note-based experiment is retained as evidence, not silently substituted for
that selected feature. Draft transmission would require an explicit draft-review
mode; completed-event filtering remains the current behavior.
