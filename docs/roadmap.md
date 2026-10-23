# Parked next-major requirement

**Status: deferred by Tom — not current implementation work.**

The next major version of `deltadb` should not require the Delta desktop app to
be installed. This is stronger than operating without an open desktop window:
it excludes invoking `delta`/`delta-app`, their background IPC service, or their
installed libraries as a hidden runtime dependency.

Current 0.x native thread/message operations still delegate to Delta. The
terminal guide and agent skill describe that reality; this roadmap must not
silently upgrade their capability claims. The current SQLite inspection and
schema sandbox already run without the app, but do not fulfill standalone
native DeltaDB semantics.

## Future acceptance questions (not a chosen design)

Research reference: [sync without Delta's service](sync-without-delta-service.md)
separates native interoperability from SQLite snapshots and a replacement
application database. Tom subsequently requested 2+ native replicas of the same
thread syncing over SSH/WebSockets/etc. and explicitly chose to preserve native
compatibility. That sync feature is now a research target, blocked on a verified
native bootstrap/export/apply contract; a replacement database is not selected.
The broader app-independent engine rewrite remains deferred.

Current requested native feature: [draft-time annotations](../research/native-annotations.md)
should let Muse reply beneath in-progress comments and create comments at chosen
visible locations, without waiting for a new LLM request. Tom chose native inline
behavior only; timeline notes are not an acceptable substitution. The verified
note-based gateway/Muse round trip is separate from that unresolved native API.

### Parked implementation preference: Effect for v2

Tom requested that the next major version consider refactoring the vanilla
TypeScript implementation to Effect. This is deferred, not part of the current
gateway/Muse prototype. Future candidates include typed native-command errors,
scoped subprocess/socket lifetimes, stream backpressure, serialized producer
writes, and durable recovery boundaries. Do not start the migration or install
Effect for the current prototype merely because this preference is recorded.

- What does standalone mean for new native databases, thread/message creation,
  reads, edits, deletion, IDs, history and durability?
- Can the required format/engine be obtained through a supported library or
  published specification? What implementation, compatibility and licensing
  evidence is needed before promising interoperability?
- Is synchronization with Delta a goal, optional adapter, or out of scope?
  App independence does not automatically mean account-free cloud access.
- Can tests run on a clean machine with no Delta installation and no account,
  using synthetic fixtures, restart/read-back and safe mutation assertions?
- How should existing native stores and current 0.x workflows migrate without
  corruption, data loss, credential copying or false claims of compatibility?

## Not authorized now

No engine rewrite, format invention, live-store migration, release/version bump,
new authentication flow, service replacement, or prototype implementation is
part of the current docs/skill task. Reopen this explicitly when Tom chooses.
