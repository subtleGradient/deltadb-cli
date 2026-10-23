Source: [data.sqlite](</home/tom/.local/share/delta/user_01m5mxxtn3heqstde6k9ew3g79/data.sqlite>)

# DeltaDB local SQLite schema

> A read-only snapshot of the installed Delta client’s local SQLite schema. This records schema DDL and version metadata only; it does not include table rows, messages, repository contents, credentials, or settings values. Delta’s local schema is an implementation detail, not a stable public API.

## Freshness / provenance

- Captured: `2026-10-23T14:08:39-04:00`
- Delta CLI: `delta 0.21.0`
- Current local account store: `user_01m5mxxtn3heqstde6k9ew3g79` (selected by `delta db users`)
- Database: `/home/tom/.local/share/delta/user_01m5mxxtn3heqstde6k9ew3g79/data.sqlite`
- Database file mtime at capture: `2026-10-23T13:57:11-04:00`
- Inspector Python SQLite library: `3.54.0` (this is the Python inspection runtime, not necessarily Delta’s linked SQLite build)
- Objects with explicit DDL: `74`; tables: `66`; explicit indexes: `8`; views: `0`; triggers: `0`
- Schema fingerprint: `sha256:793a507c6dde7a5913afc71c71e22801a0e1f2c6da91d8dd48044feb77626585`

### Version markers

| Marker | Value |
|---|---:|
| `PRAGMA schema_version` | `73` |
| `PRAGMA user_version` | `0` |
| `PRAGMA application_id` | `0` |
| `PRAGMA journal_mode` | `wal` |
| `metadata.schema_version` | `69` |
| `app_meta.repository_schema_version` | `1` |
| `app_meta.thread_mount_owners_schema_version` | `1` |
| `app_meta.workspace_schema_version` | `4` |
| `app_meta.worktree_mount_schema_version` | `3` |

`PRAGMA schema_version` is SQLite’s schema-change counter; `metadata.schema_version` and the `app_meta.*_schema_version` values are Delta-side markers. The SHA-256 fingerprint covers the sorted `sqlite_schema` rows `(type, name, tbl_name, sql)` with non-NULL SQL, JSON-encoded without extra whitespace. Use the fingerprint plus markers to notice drift; app version alone is not a schema guarantee.

## What the schema suggests

- `app_*` tables hold client-side workspace, repository, thread, mount, and worktree state.
- `history_*` tables hold history identities, actors, deltas, versions, timelines, replication state, and checkpoint/archive work.
- `nodes`, `roots`, `node_overflow_chunks`, `storage_byte_*`, and `snapshot_evolution_*` provide lower-level structured/blob storage and snapshot evolution.
- `metadata` and `app_meta` hold key/value and component-version metadata.
- Many payloads are `BLOB` or JSON/text columns with application-defined encoding. SQL DDL alone does not define those payload formats.

These are cautious interpretations of names and declared columns, not a vendor-supported schema contract.

## Operations: supported surfaces and mutation patterns

DeltaDB is not documented as a general-purpose SQL database API. Treat the SQLite file as Delta's private local persistence and replication store. Use SQL for read-only inspection; use Delta's app, checkout workflow, or CLI for changes so Delta can maintain history, causal versions, synchronization state, and derived indexes consistently. This map covers the installed CLI's local database, thread, and worktree operations; account administration and external integrations are outside this DeltaDB-focused scope.

### Read and inspection operations

| Surface | Operations | Notes |
|---|---|---|
| Bun.SQL / SQLite | `SELECT`, schema queries, and read-only `PRAGMA` inspection | Open with `readonly: true`, `create: false`, and `readwrite: false`. Do not issue SQL writes, schema changes, or maintenance pragmas against Delta's live store. |
| `delta db` | `users`, `stats`, `attribute`, `worktree-files`, `node <id>`, `root <id>` | Product-provided local storage inspection. `node` and `root` decode stored blobs through registered schemas. |
| `delta thread` | `list`, `show`, `search`, `query`, `tree`, `status`, `inspect`, `request`, `data`, `watch` | Includes transcript and replicated-thread views. `watch` is a read-only JSONL subscription; some views can expose conversation or file content. |
| `delta worktree` | `list` | Lists local standalone worktrees or, with `--thread`, worktrees attached to a shared thread. |

### High-level operations and their mutation patterns

| Intent | Supported path | Mutation pattern / caution |
|---|---|---|
| Start or resume an agent-owned conversation | `delta thread create` with `--source` and `--external-id`; optional `--parent`, `--name`, visibility, and worktree-sharing mode | Identifies the external producer and can create/reuse its thread. The create help describes producer-bound reuse; do not treat the identifiers as a secret. |
| Record an external conversation | `delta thread append --source … --external-id … <thread>` with schema-1 JSONL on stdin | Pass records from a producer that knows the contract. `--acknowledge server` (default) waits for server receipts; `local` reports local receipts. The installed CLI's `thread contract` reports supported contract versions `1..7`, but the help does not describe schema-1 record fields. |
| End a running agent turn | `delta thread stop <thread>` | Stops the current turn; it does not start another. |
| Synchronize or inspect a thread | `delta thread sync [thread…]`; `status`, `inspect`, `show` | Sync changes local/remote state; status and inspect are diagnostic reads. |
| Share or invite collaborators | `delta thread share --visibility organization`, `delta thread invite` | Sharing changes the audience. Invite uploads an unshared thread privately before inviting; a previously shared thread keeps its existing audience. Check target and audience before use. |
| Branch or discard conversation work | `delta thread fork`; `delta thread discard` | Fork creates a local thread copy, optionally at a history version/anchor. Discard previews by default; `--force` performs the discard. |
| Delete a thread | `delta thread delete` | Previews by default; `--force` deletes uniquely owned local data and the associated Cloud Runner. |
| Create/adopt a worktree | `delta worktree create`, `delta worktree attach` | Create starts from a Git checkout/revision; attach associates an existing checkout with a thread without publishing it. |
| Materialize shared files for tools | `delta worktree mount` | Synchronizes a worktree into a new directory or explicitly adopts an existing checkout. File edits in that checkout are the normal filesystem-based mutation path; Delta records and synchronizes them. |
| Integrate parallel work | `delta worktree merge --into DEST SOURCE`; `delta thread merge --into DEST SOURCE` | Worktree merge integrates a source timeline into an explicit destination of the same worktree (optional `--version` selects a history frontier). Thread merge integrates worktrees between related threads; its help warns text conflicts are written with conflict markers. Review the resulting files. |
| Manage external-agent checkout ownership | `delta thread mount --owner …` / `delta thread unmount --owner …` | Keeps all of a thread's worktrees mounted for an external owner and releases them when done; the owner identifier is client-chosen and unique within the thread. |
| Release a worktree mount | `delta worktree unmount` | Releases a worktree mount; forced removal of a Delta-created checkout can lose changes not confirmed uploaded. Adopted checkouts are preserved. |
| Return reviewed code to Git | Normal Git workflow: inspect, commit, push/open PR as appropriate | Delta records continuous work; Git remains the commit/branch/remote layer. A Delta worktree merge is not a Git commit. |

The exact available verbs and options can change with the installed client. Recheck `delta --version`, `delta thread --help --debug`, `delta worktree --help --debug`, and `delta db --help --debug` when refreshing this note. Commands with `--force`, sharing, synchronization, or publishing effects are not part of the demo's automatic path.

### Low-level recorded changes and causal mutation shape

Delta's public [Delta & Git documentation](https://delta.dev/docs/concepts/delta-and-git) describes a delta as a recorded change in a thread/worktree history. The documented broad families are:

1. **File edits** — edits to file contents.
2. **File-tree changes** — changes to which files are present / how the shared tree is structured.
3. **Messages** — conversation records.
4. **Comments** — review/collaboration annotations.
5. **Other shared-state updates** — the public description explicitly leaves room for other updates; it is not an exhaustive tagged-union reference.

The public explanation of DeltaDB describes deltas as attributed to an actor and positioned in thread history, with history versions/frontiers and concurrent ancestry. Concurrent contributors can make changes from shared history; synchronization and merge reconcile those histories rather than treating each SQLite row as an independent CRUD record. The [DeltaDB overview](https://delta.dev/blog/future-of-version-control) describes its distributed CRDT layer and text edits as ranges with inserted text. The installed database also contains encoded BLOB payloads and private indexing/replication tables. These details do **not** amount to a stable, complete write protocol.

For supported mutations, use the corresponding high-level flow:

- **Conversation recording:** producer identity (`source`, `external-id`) + ordered schema-1 JSONL records → `delta thread append` → per-record local/server receipt.
- **Filesystem editing:** create/attach or mount the intended worktree → edit files through normal tools → Delta records and synchronizes the changes → review/merge as needed → commit/push through Git if desired.
- **Parallel work:** create/fork a thread or worktree from a known base → make independent edits → explicitly merge the selected source history into a destination → inspect conflict markers and result.
- **Thread lifecycle:** create/share/sync/stop/fork/discard/delete through Delta commands, respecting the preview/force boundaries exposed by the CLI.

Do not manufacture append records or update `history_*`, `nodes`, `roots`, outbox, or timeline tables directly. The append command's public help and local `thread contract` output expose no record examples or field schema. Until Delta publishes that contract or provides a supported SDK/type definition, the prototype only validates JSONL syntax and forwards an operator-supplied file unchanged; it does not claim that syntactically valid JSON is a semantically valid Delta record.

References: [Delta & Git](https://delta.dev/docs/concepts/delta-and-git), [DeltaDB overview](https://delta.dev/blog/future-of-version-control), [Delta Worktrees](https://delta.dev/docs/concepts/worktrees), [Threads](https://delta.dev/docs/agents/threads), [Comments](https://delta.dev/docs/agents/comments), and [Review & Sync Changes](https://delta.dev/docs/agents/review-and-sync). Local command behavior was checked against Delta `0.21.0` on `2026-10-23`.

### Bun.SQL / CLI prototype

[`deltadb.ts`](./deltadb.ts) demonstrates a Bun.SQL read-only schema inspection and a guarded append pass-through. SQL inspection does not return application rows. The append command is a dry run unless `--apply` is present, and only then invokes Delta's CLI; provide a record file from a producer that already knows Delta's schema.

```bash
bun ./deltadb.ts inspect --db "$HOME/.local/share/delta/<current-store>/data.sqlite"
bun ./deltadb.ts inspect --db "$HOME/.local/share/delta/<current-store>/data.sqlite" --ddl

# Dry-run: validates JSONL syntax and reports count/hash; no Delta mutation.
bun ./deltadb.ts append --thread THREAD --source PRODUCER --external-id SESSION --records ./producer-records.jsonl

# Explicitly invokes `delta thread append` with those same records.
bun ./deltadb.ts append --thread THREAD --source PRODUCER --external-id SESSION --records ./producer-records.jsonl --apply
```

Append is a real Delta mutation and may synchronize to the server depending on acknowledgment/configuration. The prototype deliberately has no hard-coded example records.

## Complete DDL snapshot

Verbatim SQL definitions returned by `sqlite_schema` at capture time. SQLite autoindexes with NULL SQL are represented by constraints in their owning table definitions and are not repeated here.

```sql
-- index: app_threads_sidebar (on app_threads)
CREATE INDEX app_threads_sidebar
         ON app_threads(workspace_id, archived, thread_index);

-- index: history_checkpoint_builder_timeline_work_by_history (on history_checkpoint_builder_timeline_work)
CREATE INDEX history_checkpoint_builder_timeline_work_by_history
             ON history_checkpoint_builder_timeline_work (history_key, work_order);

-- index: history_checkpoint_encoding_plans_by_history (on history_checkpoint_encoding_plans)
CREATE INDEX history_checkpoint_encoding_plans_by_history
     ON history_checkpoint_encoding_plans (history_key);

-- index: history_checkpoint_publications_by_history_phase_created (on history_checkpoint_publications)
CREATE INDEX history_checkpoint_publications_by_history_phase_created
     ON history_checkpoint_publications (
         history_key,
         phase,
         created_at_ms,
         publication_uuid
     );

-- index: history_replication_archive_packs_to_prune (on history_replication_archive_packs)
CREATE INDEX history_replication_archive_packs_to_prune
             ON history_replication_archive_packs (history_key, generation, sequence)
             WHERE delta_batch_count > 0
               AND next_delta_index_to_prune IS NOT NULL;

-- index: idx_roots_saved (on roots)
CREATE INDEX idx_roots_saved ON roots(saved) WHERE saved = FALSE;

-- index: local_history_blobs_pending (on local_history_blobs)
CREATE INDEX local_history_blobs_pending
             ON local_history_blobs (history_key, oid) WHERE pending_upload = 1;

-- index: node_overflow_chunks_by_node_id (on node_overflow_chunks)
CREATE INDEX node_overflow_chunks_by_node_id
             ON node_overflow_chunks(node_id);

-- table: app_history_reclamations
CREATE TABLE app_history_reclamations (
            workspace_id BLOB NOT NULL,
            thread_id TEXT NOT NULL,
            history_id BLOB NOT NULL,
            PRIMARY KEY (workspace_id, thread_id, history_id)
        );

-- table: app_meta
CREATE TABLE app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- table: app_repositories
CREATE TABLE app_repositories (
            id BLOB PRIMARY KEY,
            repository_index INTEGER NOT NULL,
            state BLOB NOT NULL
        );

-- table: app_repository_checkout_preferences
CREATE TABLE app_repository_checkout_preferences (
            repository_id BLOB PRIMARY KEY,
            use_existing_checkout INTEGER NOT NULL
        );

-- table: app_settled_subagents
CREATE TABLE app_settled_subagents (
            child TEXT PRIMARY KEY NOT NULL,
            thread_id TEXT NOT NULL,
            version TEXT NOT NULL,
            last_used_ms INTEGER NOT NULL
        ) WITHOUT ROWID;

-- table: app_thread_mount_owners
CREATE TABLE app_thread_mount_owners (
            thread_id TEXT NOT NULL,
            owner TEXT NOT NULL,
            state_json TEXT NOT NULL,
            history_id BLOB NOT NULL,
            thread_stub BLOB,
            PRIMARY KEY (thread_id, owner)
        );

-- table: app_threads
CREATE TABLE app_threads (
            id TEXT PRIMARY KEY,
            workspace_id BLOB NOT NULL,
            history_id BLOB NOT NULL,
            thread_data_version INTEGER,
            name TEXT,
            archived INTEGER NOT NULL DEFAULT 0,
            thread_index INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER,
            last_prompted_at INTEGER,
            pinned_position INTEGER,
            status TEXT,
            has_draft INTEGER NOT NULL DEFAULT 0,
            join_id TEXT,
            primary_repository_id BLOB,
            local_content_state INTEGER NOT NULL DEFAULT 0,
            local_content_evict_after INTEGER,
            stub BLOB NOT NULL,
            state BLOB NOT NULL
        );

-- table: app_unreferenced_history_reclamations
CREATE TABLE app_unreferenced_history_reclamations (
            history_id BLOB PRIMARY KEY,
            reclaimed_at INTEGER NOT NULL
        );

-- table: app_workspaces
CREATE TABLE app_workspaces (
            id BLOB PRIMARY KEY,
            state BLOB NOT NULL
        );

-- table: app_worktree_mounts
CREATE TABLE app_worktree_mounts (
            namespace TEXT NOT NULL,
            worktree_id BLOB NOT NULL,
            repository_id BLOB NOT NULL,
            state BLOB NOT NULL,
            PRIMARY KEY (namespace, worktree_id)
        );

-- table: app_worktrees
CREATE TABLE app_worktrees (
            history_id BLOB PRIMARY KEY NOT NULL,
            repository_id BLOB NOT NULL,
            cloud_worktree_id TEXT UNIQUE,
            last_used_at INTEGER,
            state BLOB,
            CHECK ((last_used_at IS NULL) = (state IS NULL))
        );

-- table: histories
CREATE TABLE histories (
                history_key INTEGER PRIMARY KEY,
                history_uuid BLOB NOT NULL UNIQUE,
                max_timestamp INTEGER NOT NULL DEFAULT 0,
                epoch_count INTEGER NOT NULL DEFAULT 0,
                run_format INTEGER NOT NULL DEFAULT 0,
                -- Runtime scalar state. `sync_status` is a discriminant
                -- (0 = editable, 1 = requires-reload, 2 = unknown fallback).
                -- `rejected_delta_{actor,timestamp}` carry the requires-reload
                -- delta id when present; `unknown_sync_status` carries an
                -- unrecognized status's verbatim bytes. Versions are encoded
                -- text (see `encode_version_text`).
                -- `requires_reload_flagged_at_ms` and `requires_reload_cause`
                -- date and explain a requires-reload flag so a re-published one
                -- is still attributable to the incident that raised it.
                sync_status INTEGER NOT NULL DEFAULT 0,
                rejected_delta_actor INTEGER,
                rejected_delta_timestamp INTEGER,
                rejected_timeline_actor INTEGER,
                rejected_timeline_timestamp INTEGER,
                unknown_sync_status BLOB,
                requires_reload_flagged_at_ms INTEGER,
                requires_reload_cause INTEGER,
                rejection_diagnostics BLOB,
                concurrency_cutoff_version TEXT NOT NULL DEFAULT '',
                head_version TEXT NOT NULL DEFAULT '',
                last_epoch_began_at_ms INTEGER NOT NULL DEFAULT 0,
                ever_shared BOOLEAN NOT NULL DEFAULT FALSE
            );

-- table: history_actors
CREATE TABLE history_actors (
                history_key INTEGER NOT NULL,
                actor_ordinal INTEGER NOT NULL,
                actor TEXT NOT NULL,
                PRIMARY KEY (history_key, actor_ordinal),
                UNIQUE (history_key, actor)
            ) WITHOUT ROWID;

-- table: history_checkpoint_accepted_catalogs
CREATE TABLE history_checkpoint_accepted_catalogs (
        history_key INTEGER NOT NULL,
        timeline_id BLOB NOT NULL,
        publication_uuid BLOB NOT NULL,
        target_version BLOB NOT NULL,
        PRIMARY KEY (history_key, timeline_id),
        UNIQUE (publication_uuid),
        CHECK (length(publication_uuid) = 16)
    ) WITHOUT ROWID;

-- table: history_checkpoint_builder_timeline_states
CREATE TABLE history_checkpoint_builder_timeline_states (
                history_key INTEGER NOT NULL,
                timeline_actor INTEGER NOT NULL,
                timeline_timestamp INTEGER NOT NULL,
                observed_through_sequence INTEGER NOT NULL,
                desired_settled_through_sequence INTEGER,
                PRIMARY KEY (history_key, timeline_actor, timeline_timestamp),
                CHECK (observed_through_sequence >= 0),
                CHECK (
                    desired_settled_through_sequence IS NULL
                    OR desired_settled_through_sequence >= 0
                )
            ) WITHOUT ROWID;

-- table: history_checkpoint_builder_timeline_work
CREATE TABLE history_checkpoint_builder_timeline_work (
                work_order INTEGER PRIMARY KEY AUTOINCREMENT,
                history_key INTEGER NOT NULL,
                timeline_actor INTEGER NOT NULL,
                timeline_timestamp INTEGER NOT NULL,
                last_dirtied_by_sequence INTEGER NOT NULL,
                UNIQUE (history_key, timeline_actor, timeline_timestamp),
                CHECK (last_dirtied_by_sequence >= 0)
            );

-- table: history_checkpoint_encoded_objects
CREATE TABLE history_checkpoint_encoded_objects (
        publication_uuid BLOB NOT NULL,
        item_kind INTEGER NOT NULL,
        item_id BLOB NOT NULL,
        sort_key BLOB NOT NULL,
        oid BLOB NOT NULL,
        spool_uuid BLOB,
        encoded_byte_len INTEGER NOT NULL,
        PRIMARY KEY (publication_uuid, item_kind, item_id),
        UNIQUE (publication_uuid, item_kind, sort_key),
        CHECK (length(publication_uuid) = 16),
        CHECK (item_kind IN (0, 1, 2, 3)),
        CHECK (length(oid) = 20),
        CHECK (spool_uuid IS NULL OR length(spool_uuid) = 16),
        CHECK (encoded_byte_len >= 0)
    ) WITHOUT ROWID;

-- table: history_checkpoint_encoded_roots
CREATE TABLE history_checkpoint_encoded_roots (
        publication_uuid BLOB PRIMARY KEY,
        oid BLOB NOT NULL,
        spool_uuid BLOB NOT NULL,
        encoded_byte_len INTEGER NOT NULL,
        CHECK (length(publication_uuid) = 16),
        CHECK (length(oid) = 20),
        CHECK (length(spool_uuid) = 16),
        CHECK (encoded_byte_len >= 0)
    ) WITHOUT ROWID;

-- table: history_checkpoint_encoded_worktree_files
CREATE TABLE history_checkpoint_encoded_worktree_files (
        publication_uuid BLOB NOT NULL,
        worktree_id BLOB NOT NULL,
        inode_id BLOB NOT NULL,
        oid BLOB NOT NULL,
        spool_uuid BLOB,
        encoded_byte_len INTEGER NOT NULL,
        PRIMARY KEY (publication_uuid, worktree_id, inode_id),
        CHECK (length(publication_uuid) = 16),
        CHECK (length(oid) = 20),
        CHECK (spool_uuid IS NULL OR length(spool_uuid) = 16),
        CHECK (encoded_byte_len >= 0)
    ) WITHOUT ROWID;

-- table: history_checkpoint_encoding_plan_items
CREATE TABLE history_checkpoint_encoding_plan_items (
        publication_uuid BLOB NOT NULL,
        item_kind INTEGER NOT NULL,
        item_id BLOB NOT NULL,
        sort_key BLOB NOT NULL,
        reuses_base_item INTEGER NOT NULL,
        PRIMARY KEY (publication_uuid, item_kind, item_id),
        UNIQUE (publication_uuid, item_kind, sort_key),
        CHECK (length(publication_uuid) = 16),
        CHECK (item_kind IN (0, 1, 2, 3)),
        CHECK (reuses_base_item IN (0, 1))
    ) WITHOUT ROWID;

-- table: history_checkpoint_encoding_plans
CREATE TABLE history_checkpoint_encoding_plans (
        publication_uuid BLOB PRIMARY KEY,
        history_key INTEGER NOT NULL,
        base_version BLOB NOT NULL,
        target_version BLOB NOT NULL,
        section INTEGER NOT NULL,
        cursor BLOB NOT NULL,
        planned_item_count INTEGER NOT NULL,
        layout INTEGER NOT NULL DEFAULT 0,
        planned_page_count INTEGER NOT NULL DEFAULT 0,
        CHECK (length(publication_uuid) = 16),
        CHECK (section IN (0, 1, 2, 3, 4)),
        CHECK (planned_item_count >= 0),
        CHECK (layout IN (0, 1)),
        CHECK (planned_page_count >= 0)
    ) WITHOUT ROWID;

-- table: history_checkpoint_object_pages
CREATE TABLE history_checkpoint_object_pages (
        publication_uuid BLOB NOT NULL,
        item_kind INTEGER NOT NULL,
        page_index INTEGER NOT NULL,
        entry_count INTEGER NOT NULL,
        encoded_entry_count INTEGER NOT NULL,
        spool_uuid BLOB,
        entries BLOB NOT NULL,
        PRIMARY KEY (publication_uuid, item_kind, page_index),
        CHECK (length(publication_uuid) = 16),
        CHECK (item_kind IN (0, 1)),
        CHECK (page_index >= 0),
        CHECK (entry_count > 0),
        CHECK (encoded_entry_count >= 0 AND encoded_entry_count <= entry_count),
        CHECK (spool_uuid IS NULL OR length(spool_uuid) = 16)
    ) WITHOUT ROWID;

-- table: history_checkpoint_publications
CREATE TABLE history_checkpoint_publications (
        publication_uuid BLOB PRIMARY KEY,
        history_key INTEGER NOT NULL,
        generation INTEGER NOT NULL,
        timeline_actor INTEGER NOT NULL,
        timeline_timestamp INTEGER NOT NULL,
        base_version_key INTEGER NOT NULL,
        target_version_key INTEGER NOT NULL,
        replicated_through_sequence INTEGER NOT NULL,
        phase INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        UNIQUE (history_key, timeline_actor, timeline_timestamp),
        CHECK (length(publication_uuid) = 16),
        CHECK (generation >= 0),
        CHECK (replicated_through_sequence >= 0),
        CHECK (phase IN (0, 1, 2, 3, 4, 5)),
        CHECK (created_at_ms >= 0),
        CHECK (updated_at_ms >= created_at_ms)
    ) WITHOUT ROWID;

-- table: history_checkpoint_satisfied_delta_ids
CREATE TABLE history_checkpoint_satisfied_delta_ids (
                history_key INTEGER NOT NULL,
                timeline_actor INTEGER NOT NULL,
                timeline_timestamp INTEGER NOT NULL,
                actor INTEGER NOT NULL,
                timestamp INTEGER NOT NULL,
                PRIMARY KEY (
                    history_key, timeline_actor, timeline_timestamp, actor, timestamp
                )
            ) WITHOUT ROWID;

-- table: history_checkpoint_satisfied_versions
CREATE TABLE history_checkpoint_satisfied_versions (
                history_key INTEGER NOT NULL,
                timeline_actor INTEGER NOT NULL,
                timeline_timestamp INTEGER NOT NULL,
                position INTEGER NOT NULL,
                version TEXT NOT NULL,
                PRIMARY KEY (history_key, timeline_actor, timeline_timestamp, position)
            ) WITHOUT ROWID;

-- table: history_checkpoint_uploaded_location_pages
CREATE TABLE history_checkpoint_uploaded_location_pages (
        publication_uuid BLOB NOT NULL,
        page_index INTEGER NOT NULL,
        locations BLOB NOT NULL,
        PRIMARY KEY (publication_uuid, page_index),
        CHECK (length(publication_uuid) = 16),
        CHECK (page_index >= 0),
        CHECK (length(locations) <= 1000000)
    ) WITHOUT ROWID;

-- table: history_connection_states
CREATE TABLE history_connection_states (
                history_key INTEGER NOT NULL,
                timeline_actor INTEGER NOT NULL,
                timeline_timestamp INTEGER NOT NULL,
                actor INTEGER NOT NULL,
                source_version TEXT NOT NULL,
                value BLOB NOT NULL,
                PRIMARY KEY (history_key, timeline_actor, timeline_timestamp, actor)
            ) WITHOUT ROWID;

-- table: history_delta_nodes
CREATE TABLE history_delta_nodes (
                history_key INTEGER NOT NULL,
                actor INTEGER NOT NULL,
                start_timestamp INTEGER NOT NULL,
                end_timestamp INTEGER,
                parent_version TEXT NOT NULL,
                parent_version_key INTEGER NOT NULL,
                application_parent_version TEXT,
                replication_archive_pack_sequence INTEGER,
                PRIMARY KEY (history_key, actor, start_timestamp)
            ) WITHOUT ROWID;

-- table: history_delta_value_overflow_chunks
CREATE TABLE history_delta_value_overflow_chunks (
                history_key INTEGER NOT NULL,
                actor INTEGER NOT NULL,
                timestamp INTEGER NOT NULL,
                chunk_index INTEGER NOT NULL,
                data BLOB NOT NULL,
                PRIMARY KEY (history_key, actor, timestamp, chunk_index)
            ) WITHOUT ROWID;

-- table: history_delta_value_packs
CREATE TABLE history_delta_value_packs (
                history_key INTEGER NOT NULL,
                pack_id INTEGER NOT NULL,
                uncompressed_len INTEGER NOT NULL,
                live_len INTEGER NOT NULL,
                data BLOB NOT NULL,
                PRIMARY KEY (history_key, pack_id)
            ) WITHOUT ROWID;

-- table: history_delta_values
CREATE TABLE history_delta_values (
                history_key INTEGER NOT NULL,
                actor INTEGER NOT NULL,
                timestamp INTEGER NOT NULL,
                value BLOB NOT NULL,
                chunk_count INTEGER NOT NULL DEFAULT 1,
                schema_version INTEGER NOT NULL,
                pack_id INTEGER,
                pack_offset INTEGER,
                value_len INTEGER,
                PRIMARY KEY (history_key, actor, timestamp)
            ) WITHOUT ROWID;

-- table: history_dependencies
CREATE TABLE history_dependencies (
                history_key INTEGER NOT NULL,
                dependency_history_uuid BLOB NOT NULL,
                PRIMARY KEY (history_key, dependency_history_uuid)
            ) WITHOUT ROWID;

-- table: history_epochs
CREATE TABLE history_epochs (
                history_key INTEGER NOT NULL,
                timeline_actor INTEGER NOT NULL,
                timeline_timestamp INTEGER NOT NULL,
                epoch INTEGER NOT NULL,
                version TEXT NOT NULL,
                max_timestamp INTEGER NOT NULL,
                PRIMARY KEY (history_key, timeline_actor, timeline_timestamp, epoch)
            ) WITHOUT ROWID;

-- table: history_recently_incorporated_deltas
CREATE TABLE history_recently_incorporated_deltas (
                history_key INTEGER NOT NULL,
                timeline_actor INTEGER NOT NULL,
                timeline_timestamp INTEGER NOT NULL,
                position INTEGER NOT NULL,
                actor INTEGER NOT NULL,
                timestamp INTEGER NOT NULL,
                parent_version TEXT NOT NULL,
                incorporated_at_ms INTEGER NOT NULL,
                PRIMARY KEY (history_key, timeline_actor, timeline_timestamp, position)
            ) WITHOUT ROWID;

-- table: history_reclamation_queue
CREATE TABLE history_reclamation_queue (
                history_uuid BLOB NOT NULL UNIQUE
            );

-- table: history_replica_states
CREATE TABLE history_replica_states (
                history_key INTEGER PRIMARY KEY,
                generation INTEGER NOT NULL,
                last_applied_sequence INTEGER,
                highest_announced_sequence INTEGER NOT NULL,
                CHECK (generation >= 0),
                CHECK (last_applied_sequence IS NULL OR last_applied_sequence >= 0),
                CHECK (highest_announced_sequence >= 0),
                CHECK (
                    last_applied_sequence IS NULL
                    OR last_applied_sequence <= highest_announced_sequence
                )
            ) WITHOUT ROWID;

-- table: history_replication_active_timeline_updates
CREATE TABLE history_replication_active_timeline_updates (
                history_key INTEGER NOT NULL,
                timeline_actor INTEGER NOT NULL,
                timeline_timestamp INTEGER NOT NULL,
                PRIMARY KEY (history_key, timeline_actor, timeline_timestamp)
            ) WITHOUT ROWID;

-- table: history_replication_archive_packs
CREATE TABLE history_replication_archive_packs (
                history_key INTEGER NOT NULL,
                generation INTEGER NOT NULL,
                sequence INTEGER NOT NULL,
                encoded_byte_len INTEGER NOT NULL,
                delta_batch_count INTEGER NOT NULL,
                format_version INTEGER NOT NULL,
                delta_ranges TEXT,
                next_delta_index_to_prune INTEGER,
                PRIMARY KEY (history_key, generation, sequence),
                CHECK (generation >= 0),
                CHECK (sequence >= 0),
                CHECK (encoded_byte_len > 0),
                CHECK (delta_batch_count >= 0),
                CHECK (format_version > 0),
                CHECK (
                    next_delta_index_to_prune IS NULL
                    OR next_delta_index_to_prune >= 0
                )
            ) WITHOUT ROWID;

-- table: history_replication_outbox_entries
CREATE TABLE history_replication_outbox_entries (
                history_key INTEGER NOT NULL,
                entry_index INTEGER NOT NULL,
                pack_sequence INTEGER NOT NULL,
                delta_actor INTEGER NOT NULL,
                delta_timestamp INTEGER NOT NULL,
                encoded_entry_byte_len INTEGER NOT NULL,
                PRIMARY KEY (history_key, entry_index),
                UNIQUE (history_key, delta_actor, delta_timestamp),
                CHECK (pack_sequence >= 0),
                CHECK (encoded_entry_byte_len >= 0)
            ) WITHOUT ROWID;

-- table: history_replication_outbox_states
CREATE TABLE history_replication_outbox_states (
                history_key INTEGER PRIMARY KEY,
                next_entry_index INTEGER NOT NULL DEFAULT 0,
                active_pack_sequence INTEGER NOT NULL DEFAULT 0,
                total_entry_count INTEGER NOT NULL DEFAULT 0,
                total_delta_batch_count INTEGER NOT NULL DEFAULT 0,
                total_delta_byte_len INTEGER NOT NULL DEFAULT 0,
                open_delta_batch_count INTEGER NOT NULL DEFAULT 0,
                open_timeline_update_count INTEGER NOT NULL DEFAULT 0,
                open_delta_byte_len INTEGER NOT NULL DEFAULT 0,
                sealed_pack_count INTEGER NOT NULL DEFAULT 0,
                CHECK (total_entry_count >= 0),
                CHECK (total_delta_batch_count >= 0),
                CHECK (total_delta_byte_len >= 0),
                CHECK (open_delta_batch_count >= 0),
                CHECK (open_timeline_update_count >= 0),
                CHECK (open_delta_byte_len >= 0),
                CHECK (sealed_pack_count >= 0)
            ) WITHOUT ROWID;

-- table: history_replication_sealed_packs
CREATE TABLE history_replication_sealed_packs (
                history_key INTEGER NOT NULL,
                sequence INTEGER NOT NULL,
                generation INTEGER NOT NULL,
                delta_batch_count INTEGER NOT NULL,
                timeline_update_count INTEGER NOT NULL,
                encoded_timeline_updates BLOB NOT NULL,
                first_entry_index INTEGER,
                last_entry_index INTEGER,
                delta_byte_len INTEGER,
                PRIMARY KEY (history_key, sequence),
                CHECK (generation >= 0),
                CHECK (delta_batch_count >= 0),
                CHECK (timeline_update_count >= 0)
            ) WITHOUT ROWID;

-- table: history_run_headers
CREATE TABLE history_run_headers (
    history_key INTEGER NOT NULL, actor INTEGER NOT NULL, start INTEGER NOT NULL,
    encoding_version INTEGER NOT NULL,
    batches BLOB NOT NULL CHECK(length(batches) <= 1000000),
    PRIMARY KEY(history_key, actor, start)
) WITHOUT ROWID;

-- table: history_run_segments
CREATE TABLE history_run_segments (
        history_key INTEGER NOT NULL, actor INTEGER NOT NULL, run INTEGER NOT NULL,
        offset INTEGER NOT NULL,
        end_timestamp INTEGER, batch_count INTEGER, byte_count INTEGER,
        replication_archive_pack_sequence INTEGER,
        deltas BLOB CHECK(length(deltas) <= 1000000),
        CHECK (
            (offset=0 AND end_timestamp IS NOT NULL AND end_timestamp>=run
                AND batch_count IS NOT NULL AND batch_count>0
                AND byte_count IS NOT NULL AND byte_count>0)
            OR
            (offset>0 AND deltas IS NOT NULL AND end_timestamp IS NULL
                AND batch_count IS NULL AND byte_count IS NULL
                AND replication_archive_pack_sequence IS NULL)
        ),
        PRIMARY KEY(history_key, actor, run, offset)
    ) WITHOUT ROWID;

-- table: history_timeline_ancestors
CREATE TABLE history_timeline_ancestors (
                history_key INTEGER NOT NULL,
                timeline_actor INTEGER NOT NULL,
                timeline_timestamp INTEGER NOT NULL,
                position INTEGER NOT NULL,
                version TEXT NOT NULL,
                PRIMARY KEY (history_key, timeline_actor, timeline_timestamp, position)
            ) WITHOUT ROWID;

-- table: history_timeline_checkpoints
CREATE TABLE history_timeline_checkpoints (
                history_key INTEGER NOT NULL,
                timeline_actor INTEGER NOT NULL,
                timeline_timestamp INTEGER NOT NULL,
                position INTEGER NOT NULL,
                version TEXT NOT NULL,
                PRIMARY KEY (history_key, timeline_actor, timeline_timestamp, position)
            ) WITHOUT ROWID;

-- table: history_timeline_runtime_states
CREATE TABLE history_timeline_runtime_states (
                history_key INTEGER NOT NULL,
                timeline_actor INTEGER NOT NULL,
                timeline_timestamp INTEGER NOT NULL,
                concurrency_cutoff_version TEXT NOT NULL DEFAULT '',
                head_version TEXT NOT NULL DEFAULT '',
                last_epoch_began_at_ms INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (history_key, timeline_actor, timeline_timestamp)
            ) WITHOUT ROWID;

-- table: history_timeline_snapshot_evolution_states
CREATE TABLE history_timeline_snapshot_evolution_states (
        history_key INTEGER NOT NULL,
        timeline_actor INTEGER NOT NULL,
        timeline_timestamp INTEGER NOT NULL,
        target_version_key INTEGER NOT NULL,
        active_evolution_uuid BLOB,
        PRIMARY KEY (history_key, timeline_actor, timeline_timestamp),
        CHECK (
            active_evolution_uuid IS NULL
            OR length(active_evolution_uuid) = 16
        )
    ) WITHOUT ROWID;

-- table: history_timeline_sync_states
CREATE TABLE history_timeline_sync_states (
                history_key INTEGER NOT NULL,
                timeline_actor INTEGER NOT NULL,
                timeline_timestamp INTEGER NOT NULL,
                sync_status INTEGER NOT NULL,
                rejected_delta_actor INTEGER,
                rejected_delta_timestamp INTEGER,
                unknown_sync_status BLOB,
                -- `flagged_at_ms` and `cause` date and explain a rejection so a
                -- flag re-published in a later session still identifies its
                -- incident; `rejection_diagnostics` is the versioned
                -- `HistoryRejectionDiagnostics` captured with it.
                flagged_at_ms INTEGER,
                cause INTEGER,
                rejection_diagnostics BLOB,
                PRIMARY KEY (history_key, timeline_actor, timeline_timestamp)
            ) WITHOUT ROWID;

-- table: history_timeline_unpushed_delta_ids
CREATE TABLE history_timeline_unpushed_delta_ids (
                history_key INTEGER NOT NULL,
                timeline_actor INTEGER NOT NULL,
                timeline_timestamp INTEGER NOT NULL,
                position INTEGER NOT NULL,
                actor INTEGER NOT NULL,
                timestamp INTEGER NOT NULL,
                PRIMARY KEY (history_key, timeline_actor, timeline_timestamp, position)
            ) WITHOUT ROWID;

-- table: history_timelines
CREATE TABLE history_timelines (
                history_key INTEGER NOT NULL,
                timeline_actor INTEGER NOT NULL,
                timeline_timestamp INTEGER NOT NULL,
                version TEXT,
                version_key INTEGER,
                fork_metadata BLOB,
                remote_origin INTEGER NOT NULL DEFAULT 0,
                pending_creation_version TEXT,
                boundary_version TEXT,
                origin_is_known INTEGER NOT NULL DEFAULT 0,
                origin_actor INTEGER,
                origin_timestamp INTEGER,
                origin_version TEXT,
                epoch_count INTEGER NOT NULL DEFAULT 0,
                ancestors BLOB,
                PRIMARY KEY (history_key, timeline_actor, timeline_timestamp)
            ) WITHOUT ROWID;

-- table: history_unpushed_delta_ids
CREATE TABLE history_unpushed_delta_ids (
                history_key INTEGER NOT NULL,
                position INTEGER NOT NULL,
                actor INTEGER NOT NULL,
                timestamp INTEGER NOT NULL,
                PRIMARY KEY (history_key, position)
            ) WITHOUT ROWID;

-- table: history_versions
CREATE TABLE history_versions (
                history_key INTEGER NOT NULL,
                version_key INTEGER NOT NULL,
                version TEXT NOT NULL,
                PRIMARY KEY (history_key, version_key),
                UNIQUE (history_key, version)
            ) WITHOUT ROWID;

-- table: local_history_blobs
CREATE TABLE local_history_blobs (
                history_key INTEGER NOT NULL,
                oid BLOB NOT NULL,
                contents BLOB NOT NULL,
                pending_upload INTEGER NOT NULL,
                PRIMARY KEY (history_key, oid)
            );

-- table: metadata
CREATE TABLE metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

-- table: node_overflow_chunks
CREATE TABLE node_overflow_chunks (
                node_id INTEGER NOT NULL,
                chunk_index INTEGER NOT NULL,
                data BLOB NOT NULL,
                PRIMARY KEY (node_id, chunk_index)
            ) WITHOUT ROWID;

-- table: node_reclamation_queue
CREATE TABLE node_reclamation_queue (
                node_id INTEGER PRIMARY KEY
            ) WITHOUT ROWID;

-- table: nodes
CREATE TABLE nodes (
            id INTEGER PRIMARY KEY,
            refcount INTEGER NOT NULL DEFAULT 1,
            type TEXT NOT NULL,
            data BLOB NOT NULL,
            chunk_count INTEGER NOT NULL DEFAULT 1
        );

-- table: roots
CREATE TABLE roots (
            id BLOB PRIMARY KEY,
            type TEXT NOT NULL,
            data BLOB NOT NULL,
            saved BOOLEAN NOT NULL DEFAULT TRUE
        );

-- table: snapshot_evolution_cut_versions
CREATE TABLE snapshot_evolution_cut_versions (
        evolution_uuid BLOB NOT NULL,
        cut_id INTEGER NOT NULL,
        version BLOB NOT NULL,
        PRIMARY KEY (evolution_uuid, cut_id)
    ) WITHOUT ROWID;

-- table: snapshot_evolution_operations
CREATE TABLE snapshot_evolution_operations (
        evolution_uuid BLOB NOT NULL,
        operation_index INTEGER NOT NULL,
        operation BLOB NOT NULL,
        PRIMARY KEY (evolution_uuid, operation_index)
    ) WITHOUT ROWID;

-- table: snapshot_evolution_pins
CREATE TABLE snapshot_evolution_pins (
        evolution_uuid BLOB NOT NULL,
        version BLOB NOT NULL,
        reference_count INTEGER NOT NULL CHECK (reference_count > 0),
        PRIMARY KEY (evolution_uuid, version)
    ) WITHOUT ROWID;

-- table: snapshot_evolution_work
CREATE TABLE snapshot_evolution_work (
        work_order INTEGER PRIMARY KEY AUTOINCREMENT,
        evolution_uuid BLOB NOT NULL UNIQUE
    );

-- table: snapshot_evolutions
CREATE TABLE snapshot_evolutions (
        evolution_uuid BLOB PRIMARY KEY,
        history_key INTEGER NOT NULL,
        base_version BLOB NOT NULL,
        target_version BLOB NOT NULL,
        phase INTEGER NOT NULL,
        next_operation_index INTEGER NOT NULL,
        operation_count INTEGER NOT NULL,
        target_cut INTEGER,
        encoded_delta_bytes INTEGER NOT NULL,
        UNIQUE (history_key, base_version, target_version)
    ) WITHOUT ROWID;

-- table: sqlite_sequence
CREATE TABLE sqlite_sequence(name,seq);

-- table: storage_byte_spool_chunks
CREATE TABLE storage_byte_spool_chunks (
                     spool_uuid BLOB NOT NULL,
                     chunk_index INTEGER NOT NULL,
                     bytes BLOB NOT NULL,
                     PRIMARY KEY (spool_uuid, chunk_index),
                     CHECK (length(spool_uuid) = 16),
                     CHECK (chunk_index >= 0)
                 ) WITHOUT ROWID;

-- table: storage_byte_spools
CREATE TABLE storage_byte_spools (
                     spool_uuid BLOB PRIMARY KEY,
                     delete_on_drop INTEGER NOT NULL,
                     is_sealed INTEGER NOT NULL,
                     expected_byte_len INTEGER,
                     byte_len INTEGER NOT NULL,
                     chunk_count INTEGER NOT NULL,
                     CHECK (length(spool_uuid) = 16),
                     CHECK (delete_on_drop IN (0, 1)),
                     CHECK (is_sealed IN (0, 1)),
                     CHECK (expected_byte_len IS NULL OR expected_byte_len >= 0),
                     CHECK (byte_len >= 0),
                     CHECK (chunk_count >= 0)
                 ) WITHOUT ROWID;

```

## Refresh / drift check

After a Delta update or account-store change, rerun the following read-only check. A different account-store name is normal if the active account changes. If the version markers or fingerprint differ, regenerate the snapshot above from the newly selected `data.sqlite` and update this note’s freshness block and DDL.

```bash
delta --version
delta db users
STORE="$(delta db users | awk '$2 == "(current)" { print $1 }')"
DB="$HOME/.local/share/delta/$STORE/data.sqlite"
python3 - "$DB" <<'PY'
import hashlib, json, sqlite3, sys
db = sys.argv[1]
c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
rows = c.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name").fetchall()
print("schema_version", c.execute("PRAGMA schema_version").fetchone()[0])
print("user_version", c.execute("PRAGMA user_version").fetchone()[0])
print("application_id", c.execute("PRAGMA application_id").fetchone()[0])
for table in ("metadata", "app_meta"):
    print(table, c.execute(f"SELECT key,value FROM {table} WHERE key LIKE '%schema_version%' ORDER BY key").fetchall())
print("objects", len(rows))
print("sha256", hashlib.sha256(json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest())
for kind, name, table, sql in rows:
    print(f"\n-- {kind}: {name}" + (f" (on {table})" if kind == "index" else ""))
    print(sql.rstrip().rstrip(";") + ";")
c.close()
PY
```

The database uses WAL mode. Read-only schema inspection works while Delta is running; for a file-level backup, use SQLite’s backup API or close Delta first so the `data.sqlite-wal` sidecar is not omitted.

## Product-level storage distinction

This file is the per-machine local account store. Delta also synchronizes thread/worktree data to Zed’s hosted backend; the remote storage is not this SQLite file. Official docs: [Data Storage & Deletion](https://delta.dev/docs/privacy-and-security/data-storage) and [Delta & Git](https://delta.dev/docs/concepts/delta-and-git).
