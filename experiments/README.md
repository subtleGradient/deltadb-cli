# Watch → append prototype

`watch-relay.ts` is an executable, bounded **transcript relay experiment**, not
native DeltaDB replication. It tests the idea of piping `delta thread watch`
JSONL from one device into guarded `delta thread append` calls on another.

It is deliberately not installed as `deltadb sync`. Tom's native-compatibility
requirement still stands; copying messages into another thread does not satisfy
it. No raw SQLite writes, guessed recording records or private ABI are used.

## See it without writing anything

Requires Bun and a checkout of this repository. The preview itself does not
invoke Delta, create state, or make network calls. Watching a source does expose
its transcript, so use only a dedicated synthetic thread you intend to read.

```sh
bun experiments/watch-relay.ts --help
```

Save authorized native watch output to a private `source-watch.jsonl`, then:

```sh
bun experiments/watch-relay.ts \
  --from-peer device-a --from-thread SOURCE_THREAD --to-thread TARGET_THREAD \
  < source-watch.jsonl
```

It emits a preview for each accepted message. Source watch item IDs become
deterministic **new recording IDs**, and text gets a visible relay marker. This
does not preserve native delta identity, authorship, message position or history.
`--from-peer` must be a stable, unique name for the origin; it is not authenticated
by this script. Only trust input from your authorized source/SSH channel.

## Experimental SSH wiring

Run the relay on the target device, with Bun, this checkout, Delta and an
authorized account store. Source Delta must support `thread watch` (North's
observed 0.17.0 did not). SSH host access must already be configured and verified.
No listener, pairing or credential transfer is needed by this script.

```sh
set -o pipefail
ssh -T verified-source-host 'delta --json thread watch SOURCE_THREAD' |
  bun experiments/watch-relay.ts \
    --from-peer device-a --from-thread SOURCE_THREAD --to-thread TARGET_THREAD
```

That previews only. After checking the exact source, target and output, use two
**distinct disposable threads** for an authorized apply experiment:

```sh
set -o pipefail
ssh -T verified-source-host 'delta --json thread watch SOURCE_THREAD' |
  bun experiments/watch-relay.ts \
    --from-peer device-a --from-thread SOURCE_THREAD --to-thread TARGET_THREAD \
    --database-dir /private/target-delta-account-store \
    --state /private/relay-route-a-to-b --max-items 20 --apply
```

Replace placeholders; do not pass arbitrary untrusted text as the remote shell
command. The target selector is a native data directory, not a SQLite filename.
Use a private state directory on durable local storage, not this repository or
a shared folder. One writer per target producer and one relay per route.

Each append goes through the wrapper's contract, producer, exact sequence, turn
and receipt validation. A fresh target status allocates the next sequence; the
guarded append checks status again and refuses a racing frontier. A running turn
is not stopped/taken over. Acknowledgement is `local`, which is **not offline or
no-sync mode**. This experiment does not block Delta's background network traffic.

### Recovery and limits

- Preview is default. `--apply` requires explicit state and distinct thread IDs.
  Same-canonical-thread replay is refused because watch item IDs do not establish
  idempotent native delta application. A preview can still illustrate that loss.
- Accepts only completed `user_message` items (`open: false`) with text, after
  matching `ready` and `live` frames. Unsupported events are ignored, not synced:
  assistant output, tools, files, titles, deletions, edits and turn control.
- The exact placement of watch snapshots relative to `live` is not established;
  do not assume live-only delivery. Initial items may be replayed. Stable state
  deduplicates previously recorded IDs across restarts.
- Messages beginning with `[deltadb-watch-relay:` are ignored to avoid obvious
  echo loops. This is a visible-text convention, not authenticated loop detection;
  users can spoof it and suppress a message. Do not deploy multi-peer meshes.
- Repeated source ID/text is skipped. A changed text for an already seen item
  aborts; there is no message-edit API. Unsupported non-item edit events may be
  ignored without detection. Ordering/after-ID semantics are not preserved.
- Default budget: 20 new accepted messages per invocation, 1 MiB per watch frame.
  Over-budget/invalid/truncated frames fail. Process termination or EOF is not
  proof the source watch succeeded. Keep shell `pipefail` and check both statuses.
- Before applying, the relay fsyncs a `pending` intent, then writes a receipt
  after success. Failure, receipt loss or interruption leaves a pending outcome
  (and possibly a stale lock). Restart refuses it. Inspect target producer status
  and bounded read-back, reconcile manually, and preserve evidence. **Do not
  switch state directories, delete pending entries or reset sequences to retry.**
- There is no automated recovery editor. A stale lock must only be removed after
  confirming no process owns the route and reconciling its journal. Journal IDs,
  hashes and receipts can be sensitive even though raw message text is excluded.
- Single-host process/filesystem locking and fsync are a prototype safety measure,
  not a proven exactly-once distributed delivery guarantee. No WebSocket server,
  native replica bootstrap or application-level peer authorization is provided.

## Observed results — 2026-10-23

### Automated, synthetic only

Tests cover source binding, finalized user-text filtering, marker echo suppression,
preview with zero Delta calls, same-thread apply refusal, dedup after restart,
changed-message refusal, route/state mismatch, ambiguous-delivery blocking,
frame/message limits, and subprocess routing through the real wrapper guards
using a fake Delta executable. Run `bun test` from the repository root.

### Manual native attempt, Delta 0.21.0

Only dedicated synthetic test threads were used; existing user conversations
were untouched. No new sharing/invitation was used to bypass a failure.

1. Created two new, empty, local-only synthetic threads through the wrapper.
2. Started a time-bounded native watch on the new source and attempted a synthetic
   user-text append with local acknowledgement. Delta refused with:
   `share this thread or record an upload intent before appending records`.
   Status stayed at sequence 1; bounded read-back confirmed zero messages.
3. To exercise actual watch translation despite the empty source, fed the saved
   native watch output from the earlier authorized synthetic collaboration probe
   to this prototype. Preview produced one clearly marked user-text record.
4. Applied that record to the new empty target. The prototype reached the native
   guarded append, which returned the same upload-intent refusal despite local
   acknowledgement. Target status stayed at sequence 1 with zero messages.
   The journal retained its pending intent, as intended. No blind retry occurred.
5. Synthetic threads and private diagnostic state were retained for reconciliation;
   raw streams, thread/account identifiers and receipts were not committed.

**Conclusion:** watch → typed-record translation works, and guarded submission
is exercised with fake and real CLI processes. The live relay did **not** append
successfully to a local-only target, cross-device SSH delivery is **untested**,
and native same-thread replication is **not implemented**. Even a successful
append would create a new local recording, not merge original native history.
The earlier cloud-backed probe demonstrated one local watch item, not this relay
working across devices or independently of Delta's service.

Next bounded experiment: on separately authorized, already-uploaded synthetic
threads, run the SSH pipeline and confirm one target receipt/read-back. That
would test transcript relaying only. Native-compatible service-free sync still
needs the [missing bootstrap/export/apply contract](../docs/sync-without-delta-service.md).
