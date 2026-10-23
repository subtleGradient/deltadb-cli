# Synthetic collaboration probe — 2026-10-23

## Result

One new synthetic user-text record was confirmed by server acknowledgement,
bounded message read-back, and a concurrent local `delta thread watch` stream
on Delta 0.21.0. **Cross-account / cross-device realtime collaboration remains
untested.** No existing conversations were inspected or modified. This was an
explicitly authorized manual service probe, not part of `bun test`.

## Local observations

1. Previewed and applied `deltadb threads create` with a dedicated producer.
   The new thread was local-only, with `next_sequence: 1` and no running turn.
2. Started a read-only native watch without a producer; it reported `ready` and
   `live`. It was bounded with a 45-second timeout (exit 124 was intentional).
3. Previewed a synthetic user message and applied it with the default `server`
   acknowledgement. Delta refused: “share this thread or record an upload intent
   before appending records.”
4. Reconciled before trying anything else: producer sequence remained 1;
   bounded message lookup reported zero messages. No blind retry/sequence reset.
5. Used documented `delta thread invite` with the intended collaborator's email.
   It uploaded the test thread privately. The per-recipient result was
   `status: failed`, `reason: already_member`—**not a successful new invitation**.
   Follow-up status confirmed `visibility: private` and `upload.state: uploaded`.
   This does not establish the collaborator's authenticated access or distinct
   account identity. No organization-wide sharing was used.
6. Applied the same prepared message at reconciled sequence 1. Receipt:
   `disposition: recorded`, `duplicate: false`, `next_sequence: 2`, with a version.
7. `deltadb messages list --range 1-1` returned the exact synthetic marker.
   The concurrent watch also emitted a `user_message` item containing it.

The synthetic thread was retained for possible continuation. Live thread IDs,
join URLs, account IDs/emails and raw streams are deliberately not published.
This is one successful user-text path, not proof of title updates, assistant
turns, restart durability, retries, editing/deletion, or remote watcher delivery.

## North-side observations

North was contacted through Tom's approved Muse bridge. She reported:

- Bun 1.4.4 and Zed Delta 0.17.0, but no `thread contract` or `thread watch`
  subcommands in that build.
- Official `delta auth login` failed with `credential_store_unavailable` before
  the browser flow: her VM lacks Secret Service / a D-Bus session.
- No documented credential-free/session-only login route was established.
- No software installation, credential-store setup, or account change was made.

These are collaborator-reported findings, not independently executed remote
checks. A final status update was accepted by the Muse bridge but returned no
text reply; it was not resent. Earlier diagnostic replies completed normally.

## Next bounded experiment

Requires approval for North's CLI upgrade and credential-store/session changes,
then human completion of the official account sign-in. Never transmit credentials
or tokens through chat or copy another device's authentication files.

After that, verify actual contract/watch support and access to this private
synthetic thread. Use distinct producers and fresh message IDs, exchange one
nonce each way while both watches run, and compare server receipts with remote
watch/read-back events. Do not infer success from one-machine watch delivery or
an `already_member` invite result. App-independent next-major work stays deferred.
