# Native draft-time comments and replies

## Selected requirement

Tom selected **true native inline replies only**, not timeline-note fallbacks.
North/Muse should be able to:

1. Respond underneath an in-progress owner comment **before** the owner submits
   another LLM request.
2. Start a new comment on a chosen visible message, passage, or attached-code span
   in the same authorized Delta thread—not only reply where already mentioned.
3. Use the host's delegated Delta session, without Muse obtaining separate Delta
   credentials. Gateway permissions must still bound thread, actor and operations.

Arbitrary placement does not require waking Muse for every event. The mention
gate still determines when she is summoned; after that, she may choose among
authorized visible locations. Any multi-comment result needs a bounded proposal
budget and per-comment confirmation/recovery, not unbounded autonomous posting.

The existing `/comments` prototype writes labeled **timeline notes**. Its name
does not mean it implements either native operation above. It must not be used
as a silent substitute after this explicit choice. No ongoing Muse note listener
was enabled after the one-shot demonstration; the note-only test gateway was
stopped after verification. Native thread data/notes were preserved.

## What the authorized test established

On 2026-10-23, using the owner-designated `testing 123` thread:

- Native `thread watch` emitted completed transcript items and native comment
  events with comment ID, chain, author, target item and quoted span.
- A user-reported `@North` comment was absent from watch, even after explicit
  native thread sync. The owner confirmed the exact same thread link.
- A targeted read-only `delta thread data` diagnostic found the text in
  `comment_set.buffer` and the corresponding ID in `comment_set.in_progress`.
  Native data had the draft even though the completed-event stream omitted it.
- After the mention subsequently entered the native event stream, the adapter
  called the real Muse bridge once and wrote its reply as a labeled timeline
  note. Receipt and native read-back confirmed that limited success.

This proves a distinction between persisted in-progress comments and the watch
projection; it does **not** prove a native draft subscription or inline write API.
The diagnostic dump and raw comments/account IDs are not committed as fixtures.
No direct SQLite mutation or private-ABI invocation on the live app was used.

## Interface research

- Delta 0.21.0 `thread --debug --help` exposes no comment-create/reply command.
  `thread append` accepts schema-1 producer recordings; that is not a documented
  arbitrary native-comment operation.
- Public `zed-industries/delta-claude` at
  `5efb02649ac13b6404972dc38949554625447a4f`, notably
  [recording/content.ts](https://github.com/zed-industries/delta-claude/blob/5efb02649ac13b6404972dc38949554625447a4f/hooks/recording/content.ts)
  and [recording/prompt.ts](https://github.com/zed-industries/delta-claude/blob/5efb02649ac13b6404972dc38949554625447a4f/hooks/recording/prompt.ts),
  did not supply a native inline create/reply builder in the reviewed paths.
- Static symbol inspection of the installed app found internal operations such
  as `CommentSet::add_comment_with_source`,
  `CommentInteractionController::create_reply`, and
  `Thread::sync_streaming_agent_comment_reply`. These demonstrate internal
  functionality, **not a stable callable API or safe ABI**. No process was
  attached to and no private function was invoked.
- Rendered `<comment-reply>` blocks and agent-reply materialization exist
  internally. That does not establish that appending such text as an external
  message creates a correctly anchored native reply. Do not guess that shortcut
  or start/take over a model turn to make comments appear.

## Required native adapter contract (conceptual, not shipped endpoints)

| Operation | Required evidence |
| --- | --- |
| Observe draft changes | Owner-attributed draft IDs, revisions, text, chain and native target; explicit opt-in to send unfinished text |
| Create native comment | Native anchor for a selected visible item/range or attached worktree/file/version |
| Reply to native comment | Parent/chain ID; new reply attached below that comment while it remains in progress |
| Attribute delegated bot | Honest bot identification under host authorization, without fictional separate-account authentication |
| Validate target | Confirm thread/access, current revision/quote/span and no arbitrary filesystem or cross-thread target |
| Confirm write | Native comment ID, read-back/stream event and user-visible placement; no new main-model turn |

The host must resolve anchors through the engine, not silently select a matching
string or reuse stale byte offsets. Concurrent edits need version checks and
safe rejection/re-preview, not an unnoticed comment on another passage.
Native annotation permissions should be explicit; existing note-write grants
must not silently acquire broader annotation/edit/file authority.

Draft review must not send every keystroke or recursively summon agents. Define
an explicit ask-now or deliberate mention/stability rule, one-request identity,
owner gate, draft/reply budgets, cancellation and unknown-outcome reconciliation.
No native model request should be started merely to publish a draft to an
observer. Reading draft data is not itself permission to distribute it.

## Current blocker and next proof

A supported/validated native **create/reply mutation path and anchor contract**
has not been identified. Discover that path first, then test on an isolated
synthetic thread: create one root comment, reply under a still-in-progress
comment, verify native IDs/placement and unchanged model-turn state. Static
symbols alone cannot promote the feature. Any private-ABI experiment must remain
isolated/build-pinned and must never attach to live accounts or the running app.

Until that proof exists, draft-time native inline annotations are **requested,
not implemented**. The broader Effect/app-independent v2 work stays deferred.
