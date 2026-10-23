# Sync without the Delta service

Researched 2026-10-23. This is a guide to the available approaches and their
limits, **not a new sync feature in `deltadb`**. No live databases were copied,
extensions installed, or external sync services configured for this research.
The app-independent next-major implementation remains [parked](roadmap.md).

## Short answer

- **Copy a SQLite snapshot without Delta:** yes, using SQLite's backup tools and
  a transport such as SSH. This is one-way snapshot distribution, not merging.
- **Sync a separate application database without Delta:** SQLite AI's
  `sqlite-sync` is a candidate, with its own replication model and backend.
- **Merge native DeltaDB replicas without Delta's sync service:** no supported,
  verified procedure was found in the sources reviewed here. Do not treat a
  generic SQLite sync engine as a drop-in DeltaDB transport.

“No Delta service” can mean no hosted delta.dev backend, no local `delta-app`
process, or no server of any kind. These are different requirements. SQLite AI
can remove the Delta dependency for a **new database**, but its documented
quickstarts still use a sync service. A SQLite file copy requires no Delta
process or Delta account, but doesn't make native Delta operations app-free.

## Choose the outcome

| Outcome | Approach | What it does not provide |
| --- | --- | --- |
| Inspect the same captured database elsewhere | SQLite backup + private file transfer | Concurrent writers, native replica identity or merge |
| Efficient one-way remote SQLite refresh | SQLite's `sqlite3_rsync` over SSH | Bidirectional change reconciliation |
| Shared agent messages/state under our control | New database + SQLite AI `sqlite-sync` | Native Delta thread/history compatibility |
| Keep native Delta history, worktrees and concurrent edits | Delta-aware replication engine/protocol | No service-independent implementation verified here |

## 1. Snapshot copying: useful now, not multiplayer sync

SQLite's [Online Backup API](https://www.sqlite.org/backup.html) produces a
consistent snapshot, including committed data visible through SQLite when WAL
is in use. Plain `cp`, ordinary `rsync`, or Syncthing of a changing database and
its sidecars is not a transactionally consistent backup protocol. Do not drop a
live Delta account directory into a two-way file-sync folder.

### Create a separate, private snapshot

For authorized data only. Save this Python 3 example as `snapshot.py`, then call
`python3 snapshot.py /absolute/path/source.sqlite /private/path/new-snapshot.sqlite`.
The destination's parent directory must already exist and be private. The code
refuses an existing destination, opens the source read-only, and uses SQLite's
backup API. It does not invoke Delta or load any extension.

```python
import os
import sqlite3
import sys
from pathlib import Path

source = Path(sys.argv[1]).resolve(strict=True)
destination = Path(sys.argv[2]).absolute()
src = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
try:
    # Exclusive creation avoids silently replacing an existing database.
    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    dst = sqlite3.connect(destination)
    try:
        src.backup(dst)
        result = dst.execute('PRAGMA quick_check').fetchall()
        if result != [('ok',)]:
            raise RuntimeError('Snapshot failed SQLite quick_check')
    finally:
        dst.close()
finally:
    src.close()
```

If copying fails, treat the destination as incomplete; do not distribute it.
Heavy write contention can make backup take a long time. `quick_check` checks
SQLite structure, not Delta's application invariants or completeness of external
assets. Opening a WAL database read-only can require access to its existing
sidecars; use a valid SQLite-supported connection, not `immutable=1` on a changing
source. Do not change live file permissions or force a checkpoint to bypass an
access error.

Transfer the **completed snapshot**, not the live file, using authenticated SSH
or another private channel. Use a new destination filename, restrict access on
the receiving device, and compare a cryptographic checksum after transfer. Then
inspect the received copy read-only:

```sh
deltadb tables --db /private/path/received-snapshot.sqlite
deltadb schema --db /private/path/received-snapshot.sqlite
```

Do not open this copy in Delta as a second writable native replica, restore it
over an active account, or assume it contains every file/Git object needed by a
thread. A SQL snapshot may contain account-scoped/private material and replicated
actor identities. It is not a safe cross-account sharing format. Application
restore, credential handling and identity reinitialization require a separate,
supported plan. The snapshot is not a tool-created SQL-write sandbox either.

### SQLite-specific remote copy

[SQLite's `sqlite3_rsync`](https://www.sqlite.org/rsync.html) understands SQLite
transactions and can copy a live origin to a consistent remote snapshot over
SSH. Both ends need the tool; prefer compatible current versions. Its direction
is **ORIGIN → REPLICA**: the destination becomes a copy, not a merge of both.
Destination writes must not compete with replication. For this project, use it
only with a dedicated backup/inspection destination, never a live Delta account.
This tool was researched, not executed here.

## 2. SQLite AI: sync our own database, not Delta's internals

The relevant project is **[sqliteai/sqlite-sync](https://github.com/sqliteai/sqlite-sync)**,
not `sqlite-ai` (the inference extension). At the reviewed revision it provides
CRDT-backed table synchronization, UUID generation, merge policies, and network
functions. Its README documents SQLite Cloud, PostgreSQL and Supabase backends.
Its Apache-2.0 license is separate from this wrapper's MIT license.

### What the setup would involve

1. Choose a pinned extension release and supported platform/SQLite runtime.
   Loading third-party native extensions is a separate trust/install decision;
   Bun.SQL compatibility has not been tested here.
2. Create **new, disposable databases**, with the same synced schema on each
   device. Do not use Delta's native store or its captured-schema sandbox.
3. Define a small schema we own: for example an append-oriented `agent_events`
   table with globally unique text IDs and explicit author/channel fields.
4. Load the extension and initialize the table on each device. This illustrates
   local setup only; it is **not a complete network sync recipe**:

   ```sql
   -- SQLite CLI with a separately installed, reviewed extension:
   .load ./cloudsync
   CREATE TABLE agent_events (
       id TEXT PRIMARY KEY NOT NULL,
       author TEXT NOT NULL DEFAULT '',
       channel TEXT NOT NULL DEFAULT '',
       body TEXT NOT NULL DEFAULT ''
   );
   SELECT cloudsync_init('agent_events');
   INSERT INTO agent_events (id, author, channel, body)
       VALUES (cloudsync_uuid(), 'agent-a', 'synthetic-test', 'PING');
   ```

5. Provision a backend using the upstream quickstart, configure authentication
   and access rules, then use its documented network synchronization calls.
   Schema hashes must agree. Sync must be driven by the application; loading the
   extension does not create an automatic realtime listener for this wrapper.
6. Test two independent replicas, offline writes, reconnect, duplicate delivery,
   restart, deletion semantics and authorization before trusting real data.

**Important hosting distinction:** the reviewed “self-hosted PostgreSQL” guide
hosts PostgreSQL yourself but still instructs you to register it in the
CloudSync dashboard and use a managed database ID. It does **not**, by itself,
establish fully self-hosted/offline networking or direct peer-to-peer sync.
Review transport/control-plane dependencies separately if “no vendor service”
is the requirement. Never publish backend connection strings, keys or JWTs.

Schema design also matters: upstream recommends globally unique TEXT keys,
requires defaults for non-key NOT NULL columns, and warns about foreign keys
and triggers during merges. “Conflict-free” is a convergence property, not a
guarantee that arbitrary business invariants or concurrent edits are preserved
the way our application intends. Verify the selected merge policy.

## 3. Why not put sqlite-sync directly on the Delta SQLite file?

Delta's published model has causal history, actor IDs, deltas anchored to prior
versions/Git blobs, and structurally shared indexes. SQLite is its persistence
container, not the complete replication contract. Our captured store also has
encoded values, histories and derived state, not just standalone message rows.

Synchronizing individual rows/cells using a second CRDT would not automatically
preserve Delta's causal graph, projections, transaction boundaries, identities,
or format migrations. Even perfectly copied BLOB bytes do not prove that their
dependencies and indexes form a valid native history. Initializing an extension
also modifies the database's bookkeeping. **Do not run `cloudsync_init` on a
native Delta database.** A schema match alone is not compatibility evidence.

Transporting native delta batches through an alternative network might be
possible in principle, but requires a supported serialization/apply interface,
history/frontier negotiation, deduplication, missing-dependency handling,
authorization and version compatibility. None of that was established by the
parser research or the [local watch probe](collaboration-probe.md). A watch event
is not a portable input record or a verified native replication stream.

`delta thread sync` is an existing Delta CLI command, **not evidence of a
service-free sync backend**. The reviewed official docs describe replicas
communicating through Delta's sync server. No usable standalone DeltaDB engine,
self-hosted server runbook, or complete interchange protocol was identified in
this research. This is a scoped finding, not proof that one cannot exist.
The unrelated historical JavaScript project also named “DeltaDB” is not Zed's
DeltaDB and does not supply this missing contract.

## Recommendation for this project

### Tom's selected target: native-compatible multi-replica thread sync

Tom explicitly selected **preserve native compatibility**, not a standalone
replacement format. The requested CLI feature is to synchronize changes between
two or more native replicas of the same thread over a transport such as SSH
stdio or WebSockets, without the hosted Delta service. The separate-database
option above is background research, **not the selected implementation**.

Required properties:

- Preserve canonical thread identity, history/delta identities, authorship and
  causal parents. Each writer needs its own valid native actor identity; a
  byte-copied database is not a verified replica bootstrap.
- Export missing native changes relative to peer frontiers, then apply them
  through the native merge engine. Include required referenced data/Git objects,
  not just visible messages or a current JSON projection.
- Handle concurrent/offline writes, out-of-order delivery, dependency fetches,
  duplicate delivery and reconnect without inventing or losing native history.
- Work with 2+ peers and avoid forwarding loops. Relaying a previously received
  change must preserve its identity, not create a fresh local recording.
- Authenticate peers and scope access to the intended thread. SSH provides an
  encrypted/authenticated channel, not automatic per-thread authorization.
  WebSocket deployment additionally needs authenticated encrypted transport.
- Acknowledge durable application separately from merely receiving bytes;
  resume after restart from persisted native frontiers.
- Reject incompatible versions before mutation. Demonstrate native read-back
  on every replica, including concurrent edits and restart recovery, with the
  Delta service unavailable.

Transport choice comes **after** the native adapter. A future transport-neutral
adapter would need equivalents of `identify`, `frontier`, `export_missing`,
`apply_changes` and `flush`. These are conceptual requirements, **not discovered
Delta APIs or shipped CLI commands**. SSH stdio is a reasonable first transport
because it can reuse authenticated host access, but is not yet implemented.

### Native interface discovery so far

A subsequent [runnable watch → append prototype](../experiments/README.md) tests
transcript relaying explicitly. Its live local-only append attempt failed even
with local acknowledgement because Delta required sharing/upload intent. It
does not preserve native history and does not satisfy the target above.

Installed Delta 0.21.0 help was checked without opening user data:

| Surface | What help exposes | What it does not establish |
| --- | --- | --- |
| `thread sync --debug --help` | Sync local/account thread IDs | Peer URL/socket selection, independent sync engine |
| `thread watch` | Read-only JSONL events | Replayable native delta batches |
| `thread append` | Schema-1 producer recording input | Native history import/merge preserving remote IDs |
| `thread data` (debug) | Replicated data-tree JSON, optional stub input | Causal batch export plus a matching write/apply API |
| `thread inspect` (debug) | Local sync-state JSON without syncing | Protocol-compatible transport replacement |
| `db` (debug) | Storage stats and node/root decoding | A native replica writer/merger |

Official architecture material explains the CRDT but not a complete callable
replication contract. A public GitHub repository search for `deltadb` under
`zed-industries` found the Claude integration, not a standalone engine repository.
The public roadmap reviewed did not supply a self-hosted replication runbook.
These searches are not proof that an engine or private interface is unavailable.

**Implementation blocker:** a validated native bootstrap/export/apply path has
not been found. No generic socket forwarder, SQL synchronizer, or transcript
mirror will be shipped under the label “native thread sync” to hide that gap.
The next technical milestone is two synthetic native replicas exchanging one
causal change through such an adapter while disconnected from Delta's service.
Until that passes, there is no truthful working `deltadb` peer-sync command to
document. Private-ABI research, if pursued, must remain isolated/build-pinned and
must never attach to live accounts or the running app.

### Available workarounds, not substitutes for that target

- For **read-only transfer now**, use private SQLite snapshots, with no claim
  of native replica merge or account portability.
- For **non-native messaging**, a separate event database plus sqlite-sync is a
  candidate experiment, but Tom did not select replacing native Delta threads.
- For **native DeltaDB sync without Delta's service**, keep the requirement
  explicit and unresolved until an engine/protocol implementation is verified.
  Do not disguise a replacement database as a compatible native replica.

No backend, extension, daemon, migration, CLI feature or major-version rewrite
was installed/implemented here. The Python snapshot example was checked only
on synthetic SQLite data; SQLite AI setup and remote replication were not run.

## Sources and evidence

SQLite AI sources are pinned to
[`7b912ca5124cf695ae2c46c03b638354c5e255b9`](https://github.com/sqliteai/sqlite-sync/tree/7b912ca5124cf695ae2c46c03b638354c5e255b9):

- [README and network examples](https://github.com/sqliteai/sqlite-sync/blob/7b912ca5124cf695ae2c46c03b638354c5e255b9/README.md)
- [Schema requirements](https://github.com/sqliteai/sqlite-sync/blob/7b912ca5124cf695ae2c46c03b638354c5e255b9/docs/schema.md)
- [Self-hosted PostgreSQL quickstart, including dashboard dependency](https://github.com/sqliteai/sqlite-sync/blob/7b912ca5124cf695ae2c46c03b638354c5e255b9/docs/postgresql/quickstarts/postgres.md)
- [License](https://github.com/sqliteai/sqlite-sync/blob/7b912ca5124cf695ae2c46c03b638354c5e255b9/LICENSE)

Other primary sources, checked on the research date:

- [SQLite Online Backup API](https://www.sqlite.org/backup.html)
- [SQLite transaction-aware remote copy](https://www.sqlite.org/rsync.html)
- [Official DeltaDB architecture](https://delta.dev/deltadb)
- [Delta and Git concepts](https://delta.dev/docs/concepts/delta-and-git)
- [DeltaDB CRDT deep dive](https://delta.dev/blog/future-of-version-control)

Vendor features above are source-backed descriptions, not interoperability tests.
The incompatibility risks and recommendation are engineering analysis. Native
service-independent interoperability remains unknown/unverified.
