# Mutation / retrospective

Hypothesis: separating native account operations, read-only SQLite, and SQL
sandbox routes prevents the largest operational category errors.

Single packaging mutation: turn existing research/CLI knowledge into a bounded
operational skill and human recall guide, without extending native capabilities.

Discovery improvement: source audit explicitly caught two unsafe generalizations:
"all previews run no process" and "nothing writes without --apply". Candidate
instructions instead name thread-deletion preview and immediate sandbox init.

Independent review initially failed H1: the first checklist required native
Delta checks even for SQLite-only work. Repaired by selecting the lane before
dependencies and making native checks conditional. Also documented the existing
running-turn title-update limitation rather than inventing a flag.

Packaging assertions initially overfit a literal phrase for deletion preview;
the guard now checks the actual "previews through Delta" wording instead.
Running all subprocess-heavy tests alongside generation exposed the existing
5-second default per-test timeout. Integration cases now allow 30 seconds,
without changing their assertions or accessing real Delta data.
Keep if independent review and packaging/tests agree; refine concrete failures.
Next smallest future mutation: add storage/read-back evidence only after a
properly scoped isolated experiment. Do not widen claims based on parser success.
