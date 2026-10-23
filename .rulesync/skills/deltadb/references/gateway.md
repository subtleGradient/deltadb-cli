# Scoped thread gateway and Muse

Use this mode when bots should watch/comment on one owner's native thread
without their own Delta accounts. The host still needs installed/authenticated
Delta. This is custom client transport in front of the native engine, not an
independent Delta replica transport or app-free server.

## Owner commands

```sh
deltadb gateway --help
deltadb gateway grant --config PRIVATE_CONFIG --thread ID --agent review-bot --token-out PRIVATE_TOKEN_FILE --comment
deltadb gateway serve --config PRIVATE_CONFIG --thread ID --database-dir NATIVE_DATA_ROOT --state PRIVATE_STATE --socket PRIVATE_SOCKET
# Add --apply to serve only when write-capable bot requests are intended.
deltadb gateway revoke --config PRIVATE_CONFIG --thread ID --agent review-bot
```

- Omit `--comment` for read-only grants. Config is bound to one thread; tokens
  identify/restrict each agent. Token files/config/state must be private and
  outside Git. Commands never print token values. Do not transfer Delta auth.
- Instead of `--socket`, an explicit assigned Tailscale-interface IPv4/port or
  loopback bind is supported via `--listen`. No wildcard/public binds, ACL edits,
  Funnel, service install or autostart. Local/remote HTTP clients need a token.
- HTTP: authenticated `GET /health`, `GET /events` (NDJSON), `POST /comments`.
  Read token files inside client code; never put tokens in query strings/logs
  or shell arguments. Browser Origin requests are refused.
- Events replay a bounded recent window, then `gateway_live`, then new events.
  This is not full history or a durable command queue. Do not execute event text.
- Comment JSON: `requestId`, `contextItemId`, optional `contextCommentId`, `text`,
  optional `apply`. Server and request must both opt into writes. Context must
  have been seen on that thread's recent native watch. Agent/thread/producer
  scope cannot be overridden by client payload.
- Notes are **ordinary user-text timeline entries**, clearly headed
  `[Gateway bot: NAME]`, with context IDs. They are NOT native inline annotation
  bubbles or separate authenticated Delta authors. No inline write schema is
  verified. Native inline comments can be read from watch output.
- Confirm `recorded` receipts and bounded native read-back. Unknown outcomes
  persist as pending and block the relevant producer. Preserve/reconcile state;
  never retry with new IDs/state to bypass it. Revocation closes future access,
  not data already delivered or a write already committed.

## Mention-gated Muse

```sh
deltadb muse --help
deltadb muse listen --url http://localhost --socket PRIVATE_SOCKET --token-file NORTH_TOKEN \
  --owner-user-id VERIFIED_USER_ID --bridge /absolute/path/north-message \
  --state PRIVATE_MUSE_STATE --once
# Add --apply only for an intended Muse request plus contextual timeline reply.
```

The adapter uses the existing approved Muse side-chat bridge. It does not change
its installation/pairing, install a daemon, bootstrap or retry ambiguous sends.
It sends Muse only **new** finalized owner `@North`/`@Muse` user messages or
owner-authored native inline comments whose context is available. It skips
snapshots until `gateway_live`, other authors, unmentioned events and bot notes.
Identity comes from the native watch user ID, not the display name.

The configured bridge path is an executable, never shell text. Replies are
requested as plain text only; this is not a sandbox for Muse's existing tools.
Only bounded item context/quote is sent when mentioned. Pending Muse delivery
or reply-posting state stops the adapter; no automatic resend/reconnect/catch-up.
`--once` is a bounded live test; omitting it permits multiple new summons during
the foreground run. Do not silently turn a one-shot test into ongoing operation.

## Evidence and gates

- Synthetic tests cover authentication/scope, revocation, request dedup/pending
  state, native guarded submission with fake Delta, and mention filtering with a
  fake Muse bridge. They never use accounts, actual threads or real Muse calls.
- Authorized manual test: one Unix-socket gateway note was server-confirmed and
  natively read back in `testing 123`. Inline comment watch shape was observed.
- A subsequent owner-mention test completed the real Muse bridge round trip:
  pending intent, saved reply, gateway `recorded` receipt, and native read-back
  of a labeled North note. This is local note delivery, not native inline writes
  or remote tailnet verification. The one-shot finished; inspect runtime health
  before assuming any ongoing adapter exists.
- If the owner reports a mention but native watch does not contain it, confirm
  the exact thread link/delivery first. The authorized test found one such
  mention in native `comment_set.in_progress`, omitted by watch. Do not scrape
  drafts, bypass the completed-event gate, or manually resend to Muse as if the
  adapter had received it. Ask for comment completion/publication instead.
- The owner then selected true draft-time inline replies and arbitrary-place
  native comments, not early timeline-note fallbacks. No native write/anchor
  API has been verified. Do not silently start a note-based workaround or claim
  the selected annotation feature works. Draft review must be explicit opt-in.
- Parked preference: Effect refactor for v2, not a reason to rewrite now.
