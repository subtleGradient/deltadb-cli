# DeltaDB CLI

- Canonical standalone source; the dated `work` workspace bundle is an archive.
- Run `bun test` before committing. Tests must use synthetic fixtures and fake
  Delta subprocesses; never read real transcripts or mutate live user threads.
- SQL reads use read-only connections. Direct SQL writes are sandbox-only.
- Native mutations go through Delta's CLI and require explicit `--apply`.
- Do not invent schema-1 records or claim sandbox CRUD is native Delta CRUD.
- Do not commit databases, credentials, transcript fixtures, or private logs.
- Native message writes and thread updates remain unimplemented until a verified
  mutation contract is available. Keep the capability table honest.
