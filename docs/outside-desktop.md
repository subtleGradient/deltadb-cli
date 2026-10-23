# Using DeltaDB from a terminal

## The mental model

You can work **outside the desktop window**, but native Delta operations still
use the installed Delta application and an account-selected data store. Delta's
documented CLI behavior is to start the app without a window when needed. We
have verified one synthetic user-message recording/read-back on this machine,
but not cross-account realtime collaboration; see [probe results](collaboration-probe.md).
This is not a standalone, account-free DeltaDB server or SDK.

Tom's requested next-major direction is an app-independent CLI, explicitly
deferred for later; see [the parked roadmap](roadmap.md). The guide below
documents current behavior, not that future capability.

Keep these three lanes separate:

| Goal | Tool / selector | What it actually does |
| --- | --- | --- |
| Work with native threads/messages | `deltadb threads ...`, `messages ...`; optional `--database-dir DIR` | Delegates to installed `delta`; may synchronize remotely |
| Inspect an existing SQLite file | `deltadb ... --db FILE` | Reads SQLite tables/schema; does not decode the native CRDT transcript |
| Learn/test ordinary SQL CRUD | `deltadb init --db NEW_FILE`, then insert/update/delete | Creates an empty captured-schema sandbox, **not a Delta replica** |

`delta` is Zed's native CLI. `deltadb` is this Bun-based wrapper. They are not
interchangeable: wrapper commands use `threads`/`messages`; native commands use
`delta thread ...`. There is no verified `delta daemon`, general SQL write API,
account-free initializer, or message-edit/delete command here.

## 1. Check your installation without reading any conversations

```sh
bun --version
delta --version
delta thread contract
deltadb --help
```

The wrapper requires Bun 1.4+. Its native recording shapes were checked against
Delta 0.21.0. Native recording apply accepts compatible output-contract ranges
overlapping 6..7; schema-1 input is a separate version dimension.
For SQLite-only work, check only Bun and `deltadb --help`; missing native Delta
or account setup does not block file inspection or sandbox practice.

On Tom's machine, `deltadb` is already on PATH. Source and this guide live in
`/home/tom/Work/deltadb-cli`, published on GitHub. On another machine:

```sh
git clone https://github.com/subtleGradient/deltadb-cli.git
cd deltadb-cli
./deltadb --help
```

The public repository can be cloned without GitHub authentication. No dependency
installation is required beyond Bun; install/authenticate Delta separately
for native operations. If no native account store is selected, use Delta's
supported account setup, not a handcrafted account marker or copied credentials.

## 2. Read native threads and messages

Only run these against conversation data you intend to inspect:

```sh
deltadb threads list
deltadb threads get --thread THREAD_ID
deltadb messages list --thread THREAD_ID --range 1-20
```

`threads get` returns the full transcript projection. Prefer the bounded
messages range when you need only a small slice. Do not bulk-dump conversations
into agent context, Git, fixtures, or reports. Native output is JSON.

To select another Delta **data directory**:

```sh
deltadb messages list --database-dir /path/to/delta-data \
  --thread THREAD_ID --range 1-10
```

This directory is not the SQLite filename. For SQLite reads use `--db` instead.
Do not use your SQL sandbox as a native data directory.

## 3. Prepare a producer-owned thread

Use a dedicated producer identity and one writer. The external ID identifies
your recording session; keep it stable when resuming, and choose a new unique
one for an independent recording session. It is an identity, not a secret.

```sh
deltadb threads create --source deltadb-cli --external-id MY_UNIQUE_SESSION
```

That is a local preview. To actually create or reuse that producer's thread,
repeat the command with `--apply` **only when you intend the native mutation**.
Retain the returned canonical thread ID and both producer identifiers.
Do not borrow another integration's producer identity or compete for its sequence.

Before each recording mutation:

```sh
deltadb threads status --thread THREAD_ID \
  --source deltadb-cli --external-id MY_UNIQUE_SESSION
```

Use `producer.next_sequence` exactly. Do not assume it starts at 1 when a
producer/thread was reused. If you use `--database-dir`, pass the same directory
to create, status, recording, reads, and deletion.

## 4. Record a message, then change the title

Substitute the exact current sequence from status; `1` below is only an example.

```sh
deltadb messages create --thread THREAD_ID \
  --source deltadb-cli --external-id MY_UNIQUE_SESSION \
  --sequence 1 --message-id MY_FRESH_MESSAGE_ID --text 'A note from the terminal'
```

Review the returned record and target. Add `--apply` to the same command to
submit through native `delta thread append`. The wrapper checks the contract,
canonical thread/producer, sequence frontier, turn association, and receipt.
Only a `recorded` receipt confirms a new mutation at the selected acknowledgement
level. **Parser acceptance and mocked receipt tests are not end-to-end storage
proof.** Read back only your intended test thread before relying on the workflow.
The [manual probe](collaboration-probe.md) verified this user-text path once.
With default server acknowledgement, a local-only thread first required a
documented upload intent. Do not share organization-wide merely to bypass this:
an authorized invite uploads privately, while sharing changes the audience.

Recording text **does not ask a model to respond**, start a turn, or run tools.
The basic route records user text. Assistant text requires `--role assistant`
and `--turn-sequence` identifying this producer's existing running turn; the
wrapper does not start or take over that turn.

Get status again before changing a title:

```sh
deltadb threads update --thread THREAD_ID \
  --source deltadb-cli --external-id MY_UNIQUE_SESSION \
  --sequence 2 --title 'Terminal notes'
```

Again, `2` is an example, not an allocator. Title updates preview locally and
require `--apply`. Use a nonblank single line, at most 200 characters.
If this producer has a running turn, stop the rename operation: this wrapper
cannot scope a title update to that turn. Do not stop/take over a turn just to
rename its thread or invent a title-update turn flag.
Message editing and deletion remain unverified; **do not reuse a message ID
as an assumed edit**, blank its text as an assumed delete, or delete its thread
as a substitute. This wrapper refuses message update/delete.

## 5. Resume or recover safely

Keep a small operator receipt: chosen data-directory selector, canonical thread
ID, producer source/external ID, message ID, submitted sequence, acknowledgement
level, and returned receipt/version. Keep message content private; do not add
receipts/transcripts to the source repository by default.

The tool has no durable delivery queue or automatic retry/reconciliation.

| Result | Next move |
| --- | --- |
| `recorded` | Keep receipt; inspect status before the next mutation |
| `duplicate` | Do not claim a new write; inspect status and the intended thread |
| `fenced` | Output was refused for that turn; do not take over or advance blindly |
| Timeout/process error/malformed receipt | Outcome may be stored; reconcile status and bounded read-back before any replay |
| Identity/frontier/contract mismatch | Correct target/version/state; never reset sequence to force acceptance |

Default acknowledgement is `server`. `--acknowledge local` confirms local
storage only; it does **not** disable background synchronization or make a
thread private. Raw `deltadb append` is a weaker escape hatch: JSONL syntax
validation only, not the typed commands' contract/frontier/receipt checks.

## 6. Preview thread deletion deliberately

```sh
deltadb threads delete --thread THREAD_ID
```

Unlike record/create previews, this **does invoke Delta** to obtain its deletion
preview. Only after inspecting the exact target and scope should you repeat with
`--apply`. Native deletion may remove uniquely owned local data and a Cloud
Runner. It is not a verified server-wide erasure API or single-message deletion.

## 7. Read SQLite directly, without native account setup

```sh
deltadb tables --db /path/to/data.sqlite
deltadb schema --db /path/to/data.sqlite --table metadata
deltadb rows --db /path/to/data.sqlite --table metadata --limit 10
deltadb query --db /path/to/data.sqlite \
  --sql 'SELECT name FROM sqlite_schema WHERE type = ?' --params '["table"]'
deltadb inspect --db /path/to/data.sqlite --ddl
```

These open existing files read-only and do not create missing databases.
`rows` defaults to 100, maximum 10,000; it supports `--offset`. Give your own
LIMIT in arbitrary SELECT queries. Unknown SQLite tables need not have Delta's
metadata conventions. The schema is private implementation detail; many native
values are encoded BLOBs, not directly editable message rows.

## 8. Practice safely with a standalone SQL sandbox

```sh
deltadb init --db ./learning.sqlite
deltadb insert --db ./learning.sqlite --table metadata \
  --values '{"key":"practice","value":"one"}'
# Review the preview, then repeat with --apply.
deltadb rows --db ./learning.sqlite --table metadata --limit 10
deltadb update --db ./learning.sqlite --table metadata \
  --values '{"value":"two"}' --where '{"key":"practice"}'
deltadb delete --db ./learning.sqlite --table metadata --where '{"key":"practice"}'
```

`init` **immediately writes a new file**, refusing existing paths. Other SQL
mutations preview by default and require `--apply` to execute; update/delete
require a nonempty filter, which may match multiple rows. Only tool-marked
sandboxes permit direct writes. This sandbox contains captured schema plus a
marker, not accounts, native histories, CRDT roots, migrations, or sync state.
Never open it in Delta as a native replica.

## Capability and evidence checklist

- SQLite reads and sandbox CRUD: executable synthetic integration tests.
- Native thread wrappers: command routing tested with fake Delta subprocesses.
- Native text/title shapes: official-plugin source plus real isolated 0.21.0
  parser acceptance. One synthetic user-text server receipt/read-back/local-watch
  path is manually verified; title/assistant and remote delivery remain unverified.
- Individual message editing/deletion and account-free replica initialization:
  not implemented/verified.

Run `bun test` from the repository root. The optional
`python3 research/probe-parser.py` needs Linux, gdb, bubblewrap, nm, readelf, and
the exact pinned app build; never attach it to the real running application.

Sources: [wrapper reference](../README.md), [recording evidence](../research/README.md),
[Delta's release-scoped CLI lifecycle reference](https://delta.dev/docs/delta-101.md#settings-and-account),
and [official plugin](https://github.com/zed-industries/delta-claude/tree/5efb02649ac13b6404972dc38949554625447a4f).

## For agents

Load the **`deltadb`** skill. Its editable source is
`.rulesync/skills/deltadb/SKILL.md` in this repository, not the generated global
copy. Run `rulesync generate` here to install/update the skill for the configured
OpenCode and shared AgentsSkills targets. Generation uses `delete: false` and
does not intentionally remove other skills. Skill instructions are portable;
the wrapper and native Delta binaries remain explicit runtime dependencies.

In OpenCode, mention it explicitly, for example:

> @deltadb Show me the read-only commands for inspecting an existing SQLite file.

Or:

> @deltadb Prepare—but do not apply—a text recording for my dedicated producer.
