# DeltaDB CLI

Read-first SQLite tooling using Bun.SQL. Entrypoint: `./deltadb`.
Canonical source: this standalone public Git repository at
https://github.com/subtleGradient/deltadb-cli.
On this machine, `~/.local/bin/deltadb` forwards here. Requires Bun 1.4+.

Licensed under the [MIT License](LICENSE). This license covers this wrapper and
its documentation, not the separately installed Delta application.

**Start here:** [Using DeltaDB from a terminal](docs/outside-desktop.md) — the
mental model, read-first workflow, safe recording/resume, and sandbox practice.
Agents: load the [`deltadb` skill](.rulesync/skills/deltadb/SKILL.md).

**Without Delta's service:** [sync options and limitations](docs/sync-without-delta-service.md)
covers SQLite snapshots, SQLite AI sync for a separate database, and the missing
native DeltaDB replication contract.

Future direction, **parked—not implementation work now**: the next major version
should require no Delta app installation. See [roadmap](docs/roadmap.md).

## Native threads and messages

```sh
deltadb threads list
deltadb threads get --thread THREAD_ID
deltadb threads create --source deltadb-cli --external-id YOUR_UNIQUE_ID
# Add --apply to create (or reuse) the producer-bound thread.
deltadb messages list --thread THREAD_ID --range 1-20
deltadb threads delete --thread THREAD_ID
# Deletion previews by default; --apply passes Delta's --force.
```

These commands invoke Delta, not direct SQL. Reads may expose private transcript
content. They select Delta's active account; add `--database-dir DIR` to select
another account data directory explicitly. This is not a SQLite file selector.
Creating or deleting real threads may synchronize remotely. Delete may remove
uniquely owned data and the thread's Cloud Runner. Only apply after reviewing
the preview. Do not confuse thread deletion with a single-message deletion.

| Native entity | Create | Read | Update | Delete |
| --- | --- | --- | --- | --- |
| Thread | `threads create --apply` | `threads list/get/status` | Title only, `threads update` | `threads delete --apply` |
| Message | Text, `messages create` | `messages list` | Not verified | Not verified |

**Full native thread/message CRUD is not implemented.** Message editing and
deletion fail explicitly without invoking Delta. New text/title record shapes
come from Zed's public plugin and are accepted by the installed Delta parser,
not guessed; see [research evidence](research/README.md). One explicitly authorized
synthetic user-message probe confirmed server acknowledgement, read-back and a
local watch event; [cross-account collaboration remains blocked](docs/collaboration-probe.md).
Title/assistant storage effects remain unverified. Automated tests touch no real
user threads.

### Record a text message or update a title

Use a producer you own (preferably a dedicated `deltadb-cli` producer), with one
writer. Create its thread first, then copy the canonical thread ID and inspect
the producer's next sequence:

```sh
deltadb threads status --thread THREAD_ID --source deltadb-cli --external-id SESSION_ID
deltadb messages create --thread THREAD_ID --source deltadb-cli --external-id SESSION_ID \
  --sequence 1 --message-id my-message-1 --text 'Hello from the CLI'
# Add --apply after reviewing the preview.
deltadb threads update --thread THREAD_ID --source deltadb-cli --external-id SESSION_ID \
  --sequence 2 --title 'My thread'
```

The sequence numbers above are examples: always use `producer.next_sequence`
from status, never reset/reuse a sequence for different content. Use a fresh
message ID for each creation; repeated-ID replacement semantics are unverified.
These operations record transcript data, not a request to run a model. They do
not start or take over turns. Assistant output needs `--role assistant` and
`--turn-sequence N` naming the selected producer's already-running turn.

Without `--apply`, no Delta process runs. Applying checks overlap with the
source-supported output contracts 6..7, canonical thread ID, producer identity,
exact next sequence, and any turn association, then validates the one receipt.
Only `recorded` counts as a new confirmed mutation. A `duplicate`, `fenced`,
malformed receipt, or process failure is not reported as success. An ambiguous
failure may already have stored data: inspect status, do not blindly retry or
allocate another sequence. No automatic retries or durable delivery queue exist.
The default acknowledgement is `server`; `--acknowledge local` only confirms
local storage and does not disable background synchronization.

## Read an existing database

```sh
deltadb tables --db /path/to/data.sqlite
deltadb schema --db /path/to/data.sqlite --table metadata
deltadb rows --db /path/to/data.sqlite --table metadata --limit 10
deltadb query --db /path/to/data.sqlite \
  --sql 'SELECT name FROM sqlite_schema WHERE type = ?' --params '["table"]'
deltadb inspect --db /path/to/data.sqlite --ddl
```

`tables`, `schema`, `rows`, and `query` emit JSON. Read connections are opened
read-only with creation disabled and SQLite `query_only` enabled. `query` accepts
one SELECT/WITH/EXPLAIN statement; a WITH containing a write is still rejected by
SQLite. Parameters are positional JSON scalars. Rows default to 100, maximum
10,000, with optional `--offset`; query results are not automatically limited.
No database is selected implicitly. Row/query commands can expose private data:
select only the data you intend to read. This tool does not decode Delta's encoded
BLOB/CRDT records and is not a SQL security boundary for untrusted queries.

## Create and write a standalone schema sandbox

```sh
deltadb init --db ./experiment.sqlite
deltadb insert --db ./experiment.sqlite --table metadata \
  --values '{"key":"example","value":"first"}'
# Preview above; execute explicitly:
deltadb insert --db ./experiment.sqlite --table metadata \
  --values '{"key":"example","value":"first"}' --apply
deltadb update --db ./experiment.sqlite --table metadata \
  --values '{"value":"second"}' --where '{"key":"example"}' --apply
deltadb rows --db ./experiment.sqlite --table metadata
deltadb delete --db ./experiment.sqlite --table metadata \
  --where '{"key":"example"}' --apply
```

**A sandbox is not an app-ready Delta database or replica.** `init` recreates
the 66-table / 8-index captured SQLite schema, with empty application tables,
plus a tool-owned sandbox marker. It does not initialize accounts, histories,
actors, CRDT roots, migrations, or synchronization. Never point Delta at it.
The schema comes from the adjacent dated Markdown snapshot (Delta 0.21.0), not
from the currently installed Delta binary; retain that file with the scripts.
SQLite creates its own `sqlite_sequence` table. Existing paths are never replaced.

Direct CRUD only works on these marked sandboxes, never on ordinary existing
Delta databases. This is a guard against accidental misuse, not authentication.
Column names are quoted, values are bound, each applied mutation is transactional,
and foreign-key checks are enabled. Update/delete require a non-empty equality
filter: all supplied columns must match, including null via `IS`. A filter may
match multiple rows. No raw write-SQL escape hatch, BLOB input, bulk import, or
application-level Delta writes are provided. Previews show SQL/parameters without
executing it; constraints are checked only when applied.

## Native Delta writes and remaining boundary

Use the typed native commands, `delta worktree ...`, or the existing guarded
`deltadb append` pass-through for native operations. Raw append still validates
JSONL syntax only; unlike the typed commands, it does not verify contract,
producer frontier or receipt. Supply records from a known producer. An isolated test of
`delta --database-dir <empty-dir> thread create` on 2026-10-23 returned
`no_active_database`: the native CLI requires an account-selected database.
There is no verified account-free native initializer here. Standalone schema
creation and SQL CRUD do **not** create a native Delta replica. The official
plugin now supplies evidence for a subset of the recording protocol, not a
complete standalone initialization API or arbitrary native CRUD.

## Verification

```sh
bun test
```

Tests first verify reads on an ordinary SQLite fixture, including blocked writes,
then sandbox creation and CRUD, previews, constraints, and protected targets.
All fixtures live in unique `/tmp/opencode/deltadb-*` directories and are removed
by their owning tests. No live application rows are read or written by tests.
