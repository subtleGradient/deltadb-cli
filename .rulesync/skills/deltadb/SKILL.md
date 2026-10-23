---
name: deltadb
description: >-
  Use DeltaDB from a terminal or external agent through the deltadb wrapper and
  Delta CLI. Use for native threads/messages, producer recording and sequencing,
  SQLite schema inspection, and isolated SQL sandbox CRUD. Distinguish headless
  native operations from standalone databases; do not claim full message CRUD.
targets: ["*"]
---
# DeltaDB outside the desktop

## Scope and output

Use for Zed Delta/DeltaDB, `deltadb`, native threads/messages, schema inspection,
recording producers, and sandbox CRUD. Return a bounded command/preview or
authorized result, explicit target/backend, evidence level, and next safe action.
This skill does not grant permission to inspect transcripts or mutate accounts.

Do not use for Git's `delta` diff pager, unrelated database products, general
SQLite administration, OpenCode configuration, or skill authoring. Route those
to the relevant tools/skills. Tactical empathy is out of scope: this is a
technical operations skill, not stakeholder persuasion.

Read [the portable command guide](references/operations.md) for command syntax,
selectors, recovery and prerequisites. Read [evidence and evaluation](references/evidence-and-evals.md)
before extending capabilities or claiming full CRUD. No outside checkout is
required to understand these references; the named CLIs are runtime dependencies.
For scoped local/tailnet bot access and mention-gated Muse participation, read
[gateway operations](references/gateway.md). Client tokens are not Delta login credentials.

## First: select one lane

| Intent | Lane | Never substitute |
| --- | --- | --- |
| Native conversation operations | Installed `delta`, usually via `deltadb threads/messages`; optional `--database-dir DIR` | SQLite sandbox or `--db FILE` |
| Existing SQLite structure/rows | Read-only `deltadb ... --db FILE` | A decoder for native CRDT/BLOB messages |
| Synthetic SQL experimentation | `deltadb init --db NEW_FILE`, then guarded SQL CRUD | An initialized Delta replica |

Outside the desktop **window** does not mean outside the installed application.
Native CLI commands may start Delta without a window and require a selected
account store. Do not promise an account-free server, SDK, daemon, or initializer.

## Read-first workflow

1. Identify the exact target, task and lane. If native vs SQLite is ambiguous, ask one
   focused question or provide nonexecuted commands for both lanes.
2. Check Bun and `deltadb --help` without reading private data. SQLite lanes need
   no native app/account. For native operations additionally check `delta --version`;
   for native recording check `delta thread contract`. Missing Delta must not
   block SQLite inspection/sandboxes. If wrapper missing, locate/install the
   user's intended checkout; do not execute an arbitrary similarly named package.
3. Read only what is authorized and needed: schema first for SQL; bounded message
   range for conversations. Avoid full transcript gets unless necessary. Never
   ingest raw private session logs, auth files, caches, credentials, or databases
   wholesale into context or fixtures.
4. For a native write, use a producer the operator owns and one writer. Preserve
   canonical thread ID, source, external ID, fresh message ID, submitted sequence,
   acknowledgement level and receipt in an appropriate private operational note,
   not the source repository by default.
5. Preview the exact target/payload first. Execute only within explicit mutation
   authorization. A request for docs or previews does not authorize a real test thread.

## Native recording discipline

- `threads create` previews locally; applying creates/reuses a producer-bound
  thread. `threads status` reports that producer's next sequence.
- `messages create` records text; `threads update` changes title only. Both
  preview locally. Apply checks contract, identity, exact sequence, turn and
  receipt. Use the current `producer.next_sequence`, not an example number.
- Title updates cannot be scoped to a running turn in this wrapper. If the
  producer is running, stop the title operation; do not invent a turn flag or
  stop/take over its turn merely to rename a thread.
- These are transcript recordings, **not model prompts**. They do not start or
  take over agent turns. Assistant output requires the producer's existing running
  turn and `--turn-sequence`; do not fabricate a turn-start record.
- Use fresh message IDs. Same-ID replacement and individual message deletion
  remain unverified; `messages update/delete` refuse. Empty text is not deletion.
- Only `recorded` confirms a new mutation. `duplicate`, `fenced`, malformed
  receipts, timeouts or process errors require status/read-back reconciliation.
  Never silently retry, reuse a sequence for different content, or advance it to
  bypass an ambiguous outcome. There is no durable automatic delivery queue.
- Default acknowledgement is `server`. `local` is local confirmation, not an
  offline/private/no-sync switch. Native writes can synchronize remotely.
- `threads delete` previews through Delta; it is not a no-process preview. Apply
  may delete uniquely owned data and a Cloud Runner. Never substitute it for
  message deletion or promise server-wide erasure.
- Raw `append` only validates JSONL syntax. Prefer typed record commands; never
  treat raw append as having their contract/frontier/receipt guarantees.

## SQL discipline

Reads require an existing explicit file; use bounded rows/SELECT LIMIT. Never
directly update an existing native Delta store's schema/history/nodes/outbox.
SQL mutation commands permit only tool-marked sandboxes. `init` writes a fresh
file immediately without `--apply`; other mutations preview unless applied.
Update/delete require nonempty filters that may match multiple rows.

## Evidence and stop conditions

SQLite/sandbox behavior is exercised with synthetic integration tests. Native
wrapper behavior is tested using fake subprocesses. Text/title shapes come from
the official plugin and pass the installed 0.21.0 parser in an isolated process.
**Those parser/mock checks alone do not prove end-to-end native storage.** A
separate authorized manual 0.21.0 probe confirmed one synthetic user-text server
receipt, exact read-back and local watch event. Title/assistant effects and
cross-account realtime delivery remain unverified; see the bundled evidence note.

Stop and report the specific limitation if account setup, contract overlap,
producer identity/frontier, turn ownership, or receipt validation fails. Do not
edit account markers, copy credentials, patch the app, reset history, or invent
undocumented records to force acceptance. Optional private-ABI research must
remain build-pinned and isolated; never attach to the real running application.

For changes to the wrapper, run its `bun test` from the located repository root.
For skill changes, edit `.rulesync` source and run configured `rulesync generate`;
never edit generated global copies. Report commands/checks actually performed,
not hypothetical successes. Full native message CRUD is still incomplete.
