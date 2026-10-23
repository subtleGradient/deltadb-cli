# Trace plan

- Baseline: CLI README and research notes; no operational agent skill.
- Candidate: human guide + portable skill with selector/evidence invariants.
- Actual observation surfaces: independent source audit, independent casebook desk
  review, Bun packaging/CLI tests, Rulesync dry-run/generation/check, source/output
  comparison, Git diff and remote commit verification.
- No executable agent-evaluation harness is claimed. Do not fabricate raw model
  traces or convert reviewers' pass judgments into measured behavioral reliability.
- Native storage behavior remains an open gap, not a reason to run a live test
  as part of documentation validation.

## Observed review

Independent audit initially passed 11/12 casebook rows and failed unconditional
native prerequisites for SQLite-only use. After lane-gating the checks and
documenting the running-turn rename limitation, the same reviewer reported all
12/12 passing **desk review**. No executable agent behavior claim is made.

Rulesync dry-run showed only the new deltadb directories in OpenCode and shared
AgentsSkills homes; generation wrote those two skills. The harness discovered
and loaded `deltadb` immediately. `bun test` passed: 7 tests, 106 assertions,
no live native account/thread operations.
