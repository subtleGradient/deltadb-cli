# Decisions

- Create `deltadb`, not a new subagent or a generic SQLite/OpenCode mode: distinct
  native producer/frontier/receipt failures justify an operational skill.
- Canonical source lives beside the CLI in `.rulesync/skills/deltadb`; generated
  OpenCode/AgentsSkills directories are deployment targets, not editable sources.
- Global generation selects skills only and `delete: false`; no overrides that
  could regenerate unrelated configuration or duplicate Codex-specific skills.
- Tactical empathy is out of scope; this task has technical safety invariants,
  not a persuasion/hidden-negative capability claim.
- Maturity: provisional operational guidance, explicitly not full native CRUD.
- Tom's later steering requests no app-install dependency in the next major
  version, but explicitly not now. Captured separately in docs/roadmap.md; no
  redesign/version bump or change to current capability claims.
