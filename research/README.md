# Recording-contract recovery

## What changed

The earlier search missed Zed's public **delta-claude** integration. Its source
contains actual record constructors, identity/frontier handling, and receipts.
The previous claim that no public schema/example was available was too broad.
The old email draft is historical and should not be sent unchanged.

Pinned source: [5efb02649ac13b6404972dc38949554625447a4f](https://github.com/zed-industries/delta-claude/tree/5efb02649ac13b6404972dc38949554625447a4f).
This revision advertises output contracts 6..7; a newer checkout advertises 8,
which is why copying latest code without checking compatibility would be wrong.

- [delivery.ts](https://github.com/zed-industries/delta-claude/blob/5efb02649ac13b6404972dc38949554625447a4f/hooks/recording/delivery.ts): `stageOutboxRecord` constructs
  `{schemaVersion:1, sequence, ...body}`; body has `update` and optional `turnSequence`.
- [content.ts](https://github.com/zed-industries/delta-claude/blob/5efb02649ac13b6404972dc38949554625447a4f/hooks/recording/content.ts): `messageUpdates` constructs complete
  `user_message` / `agent_message` updates with `messageId` and content blocks.
- [title.ts](https://github.com/zed-industries/delta-claude/blob/5efb02649ac13b6404972dc38949554625447a4f/hooks/recording/title.ts): `recordTitle` emits `session_info_update` with `title`.
- [thread-commands.ts](https://github.com/zed-industries/delta-claude/blob/5efb02649ac13b6404972dc38949554625447a4f/hooks/cli/thread-commands.ts): contract bounds,
  producer identity/frontier, turn state, and append receipt validation.

This is public implementation evidence, not a promise that Delta's private
SQLite schema or all of its application mutations are a supported public API.
No upstream source code is vendored; our builders implement the small observed
wire shapes independently.

## Independent executable check

```sh
python3 research/probe-parser.py
```

The installed Linux `delta-app` is unstripped. The probe finds
`RecordingEnvelope::parse` with `nm`, stops a fresh process at `main`, and calls
only that parser on synthetic records via gdb. Bubblewrap disables networking,
hides `/home` and `/run`, supplies an empty HOME and clean environment, and binds
only its scratch output directory writable in addition to ephemeral mounts.
It never attaches to the running Delta app, invokes application main, reads
transcripts/accounts, or opens a Delta database. Temporary files are owned and
removed by this probe.

Private Rust ABI/layout is build-specific. The script refuses any binary whose
ELF Build ID differs from `48fc3e0c984c442bb11f14d53abd30ac81c450da` (installed
Delta 0.21.0). It is an optional research tool, not a production write backend.

Nine cases pass: user message, running-turn record, scoped assistant message,
title update, and unscoped imported assistant message are accepted; schema 2,
sequence 0, unknown envelope fields, and a missing message ID are rejected.
An initial hypothesis that unscoped assistant messages must fail was disproved
by the parser. Our live assistant-write command intentionally requires a running
turn anyway; imported historical content and live turn output are different uses.

## Evidence boundaries / remaining work

- **Proved locally:** these shapes pass the real installed envelope parser;
  malformed controls fail. This is stronger than string-name inference or mocks.
- **Tested in our CLI with synthetic subprocesses:** preview performs no calls;
  apply verifies contract, identity/frontier/turn, and receipt; refusal and
  ambiguous outcomes fail explicitly.
- **Manual service observation:** [one authorized synthetic probe](../docs/collaboration-probe.md)
  confirmed a user-text server receipt, exact bounded read-back, and local watch
  event on 0.21.0. Only the new test thread was mutated, through native commands.
- **Not proved:** cross-account realtime delivery, restart durability, retry
  behavior, and native title/assistant storage effects.
- **Still unverified:** same-message-ID edits, individual message deletion, and
  native standalone initialization. A watch `remove` event is an output event,
  not evidence for an input deletion record. Empty text is not deletion.
- No email is needed to continue from these sources. Next useful experiment is
  an isolated synthetic native replica/storage harness, with writes through
  Delta's own implementation and read-back assertions, not direct SQL mutation.
