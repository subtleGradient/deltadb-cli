# DeltaDB CLI

- Canonical standalone source; the dated `work` workspace bundle is an archive.
- Run `bun test` before committing. Tests must use synthetic fixtures and fake
  Delta subprocesses; never read real transcripts or mutate live user threads.
- SQL reads use read-only connections. Direct SQL writes are sandbox-only.
- Native mutations go through Delta's CLI and require explicit `--apply`.
- Do not invent schema-1 records or claim sandbox CRUD is native Delta CRUD.
- Do not commit databases, credentials, transcript fixtures, or private logs.
- Text message creation and thread-title updates use official-plugin record
  shapes accepted by the 0.21.0 parser; see research/README.md. Message update
  and delete remain unverified. Parser acceptance is not storage-level proof.
- Keep the capability table honest. Never extend private-ABI probes to real
  processes/accounts; the research probe must remain isolated and build-pinned.
