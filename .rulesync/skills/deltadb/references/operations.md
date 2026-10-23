# Portable command guide

## Dependencies and version scope

`deltadb` is a Bun 1.4+ wrapper; `delta` is Zed's installed native CLI, not the
unrelated Git diff pager. Native commands require an account-selected Delta store
and may launch the application without a window. SQLite reads/sandboxes do not
require a native account. For every lane, check without reading conversations:

```sh
deltadb --help
bun --version
```

For native operations additionally run `delta --version`; for native recording,
also run `delta thread contract`.

Choose the lane before prerequisite checks: SQLite work needs only Bun/wrapper;
run native version/contract checks only for native operations/recording. Missing
Delta or an account must never block SQLite inspection/sandbox practice.

Observed parser: Delta 0.21.0. Typed recording apply requires overlap with output
contracts 6..7. The input envelope's schemaVersion 1 is a different version axis.
Wrapper source and fuller human guide: https://github.com/subtleGradient/deltadb-cli
(private; access required). Do not rely on that checkout to interpret this skill.

## Native reads and producer-owned recording

All uppercase values are placeholders. These reads can expose private data;
execute only for the authorized scope. Prefer a small message range over full get.

```sh
deltadb threads list
deltadb threads get --thread THREAD_ID
deltadb messages list --thread THREAD_ID --range 1-20
deltadb threads create --source deltadb-cli --external-id UNIQUE_SESSION
deltadb threads status --thread THREAD_ID --source deltadb-cli --external-id UNIQUE_SESSION
deltadb messages create --thread THREAD_ID --source deltadb-cli --external-id UNIQUE_SESSION \
  --sequence 1 --message-id FRESH_MESSAGE_ID --text 'Example text'
deltadb threads update --thread THREAD_ID --source deltadb-cli --external-id UNIQUE_SESSION \
  --sequence 2 --title 'Example title'
deltadb threads delete --thread THREAD_ID
```

- Create/text/title commands above are local previews. Add `--apply` only for an
  authorized native mutation. Thread deletion preview invokes Delta; its apply
  passes native `--force`, potentially removing uniquely owned data/Cloud Runner.
- A native `--database-dir DIR` selects a data directory, not a SQLite filename;
  use the same selector throughout a workflow or the intended active account.
- Create may reuse the producer's thread. Save its canonical ID and producer
  identity. Inspect status before **each** recording; replace example 1/2 with
  the exact `producer.next_sequence`. One writer; do not impersonate another
  integration. Independent recordings get independent unique external IDs.
- Use fresh message IDs. No verified same-ID edit/delete semantics.
- Text recording does not invoke a model. Assistant output additionally needs
  `--role assistant --turn-sequence N`, naming an already-running producer turn.
  The wrapper does not start or take over that turn.
- Title: nonblank, one line, max 200 characters. No general metadata update API.
  The wrapper cannot scope title updates to a running turn, so stop a rename if
  that producer is running; do not invent a flag or take over/stop its turn.
- Optional `--acknowledge local|server`, default server. Local confirmation does
  not stop background sync. Only `recorded` means a newly confirmed mutation.
- Applying typed records verifies contract overlap, canonical ID, producer,
  frontier/turn and receipt. Those guards are tested synthetically; native
  storage effects are not yet end-to-end verified.
- Raw `deltadb append` is a JSONL syntax-only pass-through. Do not invent records
  or imply it validates semantics, identity/frontier, or receipts.

## Recovery

Keep operational receipts private: target, producer identity, message ID, sequence,
ack level, returned version/disposition. No automatic delivery queue exists.
After duplicate/fenced/timeout/process error/invalid receipt, do not allocate or
replay blindly. Inspect authorized producer status and bounded read-back first.
Failure can mean the append was stored but its acknowledgement was lost.
Never reset the sequence or take over another running producer to make it pass.

## Existing SQLite reads

```sh
deltadb tables --db /path/to/data.sqlite
deltadb schema --db /path/to/data.sqlite --table metadata
deltadb rows --db /path/to/data.sqlite --table metadata --limit 10
deltadb query --db /path/to/data.sqlite \
  --sql 'SELECT name FROM sqlite_schema WHERE type = ?' --params '["table"]'
deltadb inspect --db /path/to/data.sqlite --ddl
```

Read connections disable creation and writes. `rows` defaults to 100, max 10,000,
with optional `--offset`. `query` accepts one SELECT/WITH/EXPLAIN; supply LIMIT
yourself, since arbitrary result sets have no automatic cap. SQL scalar params
are positional JSON. Native transcript data may be encoded BLOB/CRDT storage,
not directly editable message rows. Prefer native bounded reads for conversations.

## Standalone schema sandbox

```sh
deltadb init --db ./experiment.sqlite
deltadb insert --db ./experiment.sqlite --table metadata --values '{"key":"example","value":"one"}'
deltadb rows --db ./experiment.sqlite --table metadata --limit 10
deltadb update --db ./experiment.sqlite --table metadata --values '{"value":"two"}' --where '{"key":"example"}'
deltadb delete --db ./experiment.sqlite --table metadata --where '{"key":"example"}'
```

`init` immediately creates a new file, refusing existing paths. Other SQL writes
preview; add `--apply` only when authorized. Update/delete filters are mandatory
but can match multiple rows. These writes require the tool's sandbox marker.
The captured 0.21.0 schema has empty application tables plus a marker, not native
accounts/replica initialization. Never point Delta at it. No direct live SQL
mutation, arbitrary write-SQL escape hatch, BLOB-input API, or full native CRUD.
