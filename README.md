# DeltaDB CLI

Read-first SQLite tooling using Bun.SQL. Entrypoint: `./deltadb`.
Canonical source: this standalone Git repository, backed up privately to
https://github.com/subtleGradient/deltadb-cli.
On this machine, `~/.local/bin/deltadb` forwards here. Requires Bun 1.4+.

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
| Thread | `threads create --apply` | `threads list/get` | Not supported | `threads delete --apply` |
| Message | Unverified append contract | `messages list` | Not supported | Not supported |

**Full native thread/message CRUD is not implemented.** Unsupported mutations
fail explicitly without invoking Delta. `append` can forward genuine producer
JSONL but does not establish that message creation/editing/deletion is supported.
Native command routing is tested with a fake Delta process; no real user threads
are created, read, or deleted by the tests.

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

Use `delta thread create`, `delta worktree ...`, or the existing guarded
`deltadb append` pass-through for native operations. Append still needs genuine
schema-1 producer records; this CLI does not invent them. An isolated test of
`delta --database-dir <empty-dir> thread create` on 2026-10-23 returned
`no_active_database`: the native CLI requires an account-selected database.
There is no verified account-free native initializer here. Standalone schema
creation and SQL CRUD do **not** solve the unpublished Delta mutation protocol.

## Verification

```sh
bun test
```

Tests first verify reads on an ordinary SQLite fixture, including blocked writes,
then sandbox creation and CRUD, previews, constraints, and protected targets.
All fixtures live in unique `/tmp/opencode/deltadb-*` directories and are removed
by their owning tests. No live application rows are read or written by tests.
