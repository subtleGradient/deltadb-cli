# Falsification evidence

- [SUPPORTS] Wrapper implements native routes and isolated SQLite reads/sandbox writes.
- [FALSIFIES standalone prior] Native account-free creation returned no_active_database.
- [FALSIFIES full-CRUD prior] Message update/delete explicitly refuse.
- [FALSIFIES uniform-preview prior] Init writes immediately; thread-delete preview invokes Delta.
- [SUPPORTS bounded publication] Existing parser and synthetic tests have clear evidence limits.
