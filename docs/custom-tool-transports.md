# Custom tools collaborating in one native Delta thread

## Two different transports

There is a usable composition point **in front of** Delta's engine:

```text
tool A ── SSH / local subprocess ──┐
                                 ├─ gateway host: deltadb → installed Delta → native thread
tool B ── SSH / local subprocess ──┘                        │
                                                          └─ Delta's sync backend
```

Tools can watch the same canonical thread and submit their own producer records
through one authorized gateway. They need not maintain independent native
replicas, replay each other's messages, or install Delta on every tool device.
The gateway still needs Delta and an account; do not confuse this topology with
an app-independent CLI or a replacement for Delta's service.

**Replacing the replica transport underneath `delta thread sync` is different.**
The installed 0.21.0 CLI exposes no peer URL/socket/backend option for `sync`.
No native history export/apply adapter has been verified. Neither SSH nor a
WebSocket wrapper supplies that missing merge interface. This guide does not
change the [native-compatible multi-replica target](sync-without-delta-service.md).

## Wrapper commands

```sh
deltadb thread watch --thread THREAD_ID --database-dir /private/gateway-store
deltadb thread sync --thread THREAD_ID --database-dir /private/gateway-store
# Review sync preview, then repeat with --apply only when intended.
```

`thread` is an alias for `threads`. `watch` streams native JSONL without buffering
the entire transcript. It does not supply producer flags, join participation or
keep a turn alive. The stream may include initial state and sensitive content;
it is not a durable queue, authenticated user command channel, or proven native
delta export format.

`sync` previews locally and requires `--apply` to invoke native Delta sync. It
requires one explicit thread ID, never implicitly syncs all threads, and may
move data to/from Delta's existing service. There is **no custom `--transport`
flag**: unknown options fail instead of silently falling back to hosted sync.

## SSH as the custom-tool transport

Only use a trusted gateway and an already verified SSH host alias. Account
sign-in stays on that host; do not copy tokens/auth files to clients or pass
credentials through this protocol. No listener/service installation is required
by these commands.

On each tool device, start a separate read connection:

```sh
ssh -T verified-gateway \
  'deltadb thread watch --thread THREAD_ID --database-dir /private/gateway-store'
```

Then obtain the next sequence for **that tool's own producer**:

```sh
ssh -T verified-gateway \
  'deltadb thread status --thread THREAD_ID --source tool-a --external-id SESSION_ID --database-dir /private/gateway-store'
```

Use the exact `producer.next_sequence`. Generate a fresh message ID, then preview
the write, passing message content on stdin rather than interpolating it into a
remote shell command:

```sh
printf '%s' 'Synthetic result from tool A' |
  ssh -T verified-gateway \
    'deltadb messages create --thread THREAD_ID --source tool-a --external-id SESSION_ID --sequence NEXT_SEQUENCE --message-id FRESH_ID --database-dir /private/gateway-store --text-stdin'
```

That is a local record preview on the gateway. After reviewing its target and
payload, repeat with `--apply` added to the **fixed** remote command only when
the write is authorized. Stdin must be valid nonempty UTF-8; input exceeding
16 MiB is refused, and the full record must fit the native record-size limit.
Use only bounded synthetic text for the first check.

For a real custom tool, pipe its text output instead of `printf`. Keep remote
command arguments fixed or construct them with a shell-safe argument serializer;
do not concatenate untrusted thread IDs, producer IDs, flags or text into SSH
shell strings. For structured tool output, the application may format a JSON
object as text, but that does not make it a native structured tool-call record.

Tool B watches the **same THREAD_ID**, uses its own `--source tool-b` and stable
session ID for writes, and follows the same status/receipt discipline. Do not
start a second watcher-to-append mirroring loop for events already in the thread.

## Protocol and safety responsibilities

- Use one writer per producer. Different tools/producers can write the same
  thread; do not share sequence allocation across writers. A race still causes
  the typed append to refuse a stale frontier, not silently allocate/retry.
- Keep message ID, sequence, target, acknowledgement level and receipt before
  issuing another write. There is no built-in durable command queue.
- Only `recorded` confirms a newly stored record. A connection drop, timeout,
  invalid receipt or duplicate/fenced result requires reconciliation via status
  and bounded read-back, not blind retransmission with a new sequence.
- Use watch `ready`/`live` as stream lifecycle indications, not proof another
  tool processed or durably acknowledged a message. Watch output may repeat on
  reconnect. Application-level requests need their own IDs and explicit replies.
- Treat watched text as untrusted data, not instructions to execute commands.
  An arbitrary thread participant must not gain arbitrary command execution in
  a connected tool. Enforce each tool's own allowlist and authorization gates.
- SSH authenticates gateway access, not per-thread isolation. Giving an SSH user
  unrestricted shell access is broad authority. Multi-user production deployment
  needs a deliberately restricted gateway/account and thread authorization;
  this guide does not install that security boundary.
- Writes may synchronize remotely. Local acknowledgement does not disable sync;
  the [live relay probe](../experiments/README.md) found even local-ack append
  refused a thread without sharing/upload intent. Do not widen thread visibility
  just to make recording work.
- User-text recording does not invoke a model or start a turn. Assistant text
  requires an existing owned running turn; no new generic tool-call/turn records
  are invented here. Full edit/delete/file replication is not provided.

## WebSockets and other channels

A gateway could expose the same operations over authenticated WebSockets:
subscribe to a scoped watch stream, submit bounded typed recording requests,
return native receipts, and expose deliberate sync requests. That WebSocket
server is **not implemented**. Before adding one, specify TLS, peer identity,
thread ACLs, backpressure, budgets, disconnect reconciliation and single-writer
producer ownership. Never expose a raw unauthenticated append socket.

Local subprocess pipes, SSH stdio and such a future WebSocket gateway are **tool
transports**, not interchangeable implementations of Delta's replica protocol.
This distinction lets arbitrary custom tools use one native thread without
claiming the unfinished service-independent replication feature works.

## Verification boundary

Wrapper routing, singular alias, no-process sync preview, stdin text validation,
and guarded stdin apply are covered by synthetic tests/fake Delta subprocesses.
The upstream native watch/append path has the separately documented manual
synthetic observations. A subsequent manual attempt used only the previously
created synthetic thread: a bounded wrapper watch and status queries for two
fresh tool producers all returned native `disconnected` errors. No new message
writes were attempted, and the app/account configuration was not changed to
force the test through.

This release has **not** verified the two-producer exchange, two remote tools,
SSH delivery or a WebSocket gateway end to end. The runnable plumbing is tested;
the native connectivity failure is a remaining integration blocker. Run
`bun test` before extending it.
