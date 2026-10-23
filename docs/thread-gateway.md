# Scoped bot access to your Delta thread

The gateway lets local programs and remote agents **watch one chosen native
thread and post attributed contextual notes using your host's existing Delta
session**. Clients need a gateway token, not their own Delta login, and never
receive your Delta credentials. This is a foreground prototype, not an installed
daemon or a replacement for Delta's service.

**Comment limitation:** writes currently appear as ordinary user-text entries
headed `[Gateway bot: AGENT]`, with the referenced item/comment IDs. They are
not native inline comment bubbles or independently authenticated Delta users.
Reading native inline-comment events is supported; a verified API for writing
those native annotations has not been found. No such records are invented.

## Owner setup (Linux, Bun, installed/authenticated Delta)

Use a canonical thread ID you intend to expose, and a private directory outside
Git. No setup command prints token values. `grant` creates a new owner-only
token file and stores only its hash in the server config; existing token files
are never overwritten.

```sh
deltadb gateway grant \
  --config ~/.local/state/deltadb-bots/capabilities.json \
  --thread THREAD_ID --agent review-bot \
  --token-out ~/.local/state/deltadb-bots/review-bot.token --comment
```

Omit `--comment` for a read-only grant. Repeat with a different agent name/token
file for each program. Every grant in a config is restricted to that one thread.
Multiple thread gateways require separate configs/state and listeners.

Start a local-only Unix HTTP socket:

```sh
deltadb gateway serve \
  --config ~/.local/state/deltadb-bots/capabilities.json --thread THREAD_ID \
  --database-dir ~/.local/share/delta \
  --state ~/.local/state/deltadb-bots/gateway-state \
  --socket ~/.local/state/deltadb-bots/gateway.sock
```

Without `--apply`, the server permits preview requests only. Add `--apply` to
enable actual writes from comment-capable clients; clients must also explicitly
submit `"apply": true`. Server startup creates local state/locks even in preview
mode and starts an authorized read-only native watch.

`--database-dir` is Delta's native data-directory selector, not a SQLite file.
The live test used `~/.local/share/delta` (the root containing the active account
selection), not its per-account `data.sqlite` file. Verify selection with native
status; never create/copy account markers or credentials to make it work.

## Remote clients over Tailscale

Instead of `--socket`, use `--listen YOUR_ASSIGNED_TAILSCALE_IPV4:8787`.
The server checks the address belongs to a local `tailscale*` interface and is
in the Tailscale IPv4 range. It refuses wildcard, LAN and public binds. Loopback
`127.0.0.1:PORT` is also supported. A tailnet listener can serve both local and
remote clients with the same per-agent token requirements.

No Tailscale installation, ACL changes, port forwarding, Funnel or background
service setup is performed. Ensure existing tailnet policy permits only the
intended peers. HTTP is inside Tailscale's encrypted channel, not application
TLS; do not proxy it onto the public Internet. Tailscale membership alone does
not grant access: every request still requires a scoped gateway token.

Provision **only that agent's gateway token** to its private client-side file
through a channel you already trust. Do not copy Delta auth material or the
server's full capability config. A client needs HTTP support, not installed
Delta or a separate Delta account. This does not confer SSH/shell access.

## HTTP protocol

All routes require `Authorization: Bearer TOKEN`. Do not put tokens in URLs,
shell command arguments, transcripts or logs. Read them inside client code from
a private file. Browser-origin requests and query parameters are refused; this
is an agent API, not a browser-facing app with CORS enabled.

| Route | Permission / response |
| --- | --- |
| `GET /health` | Scoped read; native connectivity, write mode and agent label |
| `GET /events` | Scoped read; streaming `application/x-ndjson` |
| `POST /comments` | Comment grant; contextual note preview/apply |

`/events` begins with a `gateway` envelope and bounded recent native events,
wrapped as `{"type":"delta","event":NATIVE_FRAME}`. It then emits
`{"type":"gateway_live",...}` before newly received events. Applications should
not treat the replay as new commands. There is no full-history or missed-event
guarantee. Clients may see repeated native IDs; native disconnects close streams
and make new subscriptions fail until the host restarts/reconciles the gateway.
Idle connections receive lightweight `gateway_heartbeat` packets every 15 seconds
so an otherwise quiet thread does not trip an HTTP idle timeout. Heartbeats are
not thread events and must not summon agents.

A comment request uses a context item currently in the gateway's bounded watch
index. If responding to an observed inline comment, include its comment ID too:

```json
{
  "requestId": "review-unique-stable-id",
  "contextItemId": "WATCH_ITEM_ID",
  "contextCommentId": "OPTIONAL_WATCH_COMMENT_ID",
  "text": "The bot's observation about this item.",
  "apply": false
}
```

Omit `contextCommentId` when responding directly to a message. The server checks
that an optional comment actually targets the supplied item; clients cannot pick
arbitrary unseen context. It never accepts client-selected thread IDs, native
records, producer identities, command names, filesystem paths or SQL.

Use a preview first. Applying requires the exact same intended content with
`apply: true`. A confirmed repeated request ID/content returns its stored receipt
without another append. Reusing an ID with different content fails. Unknown
outcomes remain pending and block that agent's producer until host-side manual
reconciliation. A preflight failure before append records no intent and reports
that no append was attempted. Never bypass pending state by changing request IDs
or state directories.

## Local Python client sketch

Standard-library HTTP works over the Unix socket; no token appears in process
arguments. Replace the URL/connection with ordinary HTTP for a tailnet client.

```python
import http.client, json, pathlib, socket
root = pathlib.Path.home() / '.local/state/deltadb-bots'
class Local(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX)
        self.sock.connect(str(root / 'gateway.sock'))
headers = {'Authorization': 'Bearer ' + (root / 'review-bot.token').read_text().strip()}
connection = Local('localhost')
connection.request('GET', '/events', headers=headers)
response = connection.getresponse()
if response.status != 200:
    raise RuntimeError('Gateway unavailable or permission denied')
for line in response:
    event = json.loads(line)
    # Observe/filter events here. Never execute watched text as shell instructions.
```

Use a **separate connection** to POST a JSON comment while the event stream is
open. Check the status code and receipt before treating a write as successful.

## Revocation, scope and limits

```sh
deltadb gateway revoke \
  --config ~/.local/state/deltadb-bots/capabilities.json \
  --thread THREAD_ID --agent review-bot
```

Revocation is rechecked on every request, queued write, and published event;
idle subscriptions are pruned periodically. Already delivered data cannot be
revoked. Stop the server with Ctrl-C; it is not configured to auto-start.

- Default grants are read-only. Comment grants allow contextual **timeline text
  notes**, not edits, deletes, filesystem changes, arbitrary append schemas,
  model calls, new threads, sync commands or account administration.
- Native calls run on the host under its existing Delta account. A successful
  native receipt/read-back does not prove the desktop UI rendered a comment.
  Native server acknowledgements may require upload/sharing intent; no audience
  widening or account changes are performed automatically.
- Up to 32 subscribers and 16 queued requests; bounded event buffers and context
  indexes. Slow subscribers are disconnected. Comment text is capped at 16 KiB;
  request bodies at 32 KiB. One server owns a durable-state lock.
- Native items explicitly labeled agent-thought/thinking/reasoning are omitted
  from this gateway, not exported or accepted as comment context. This is a
  structural filter, not a general secret-redaction/DLP guarantee for tool text.
- Journal files contain request hashes/IDs and receipts, not raw comment bodies.
  Preserve pending state after crashes. Stale locks need owner reconciliation,
  not automatic deletion or takeover. This is not a proven exactly-once system.
- Host filesystem access is trusted. Remote capability clients do not receive
  that authority. Public-server hardening, cross-platform support, external TLS
  termination and multi-user identity federation are not provided.

## Live test and Muse

On 2026-10-23, with Tom's explicit permission, the Unix-socket gateway posted
one labeled contextual note to **testing 123**. A server-confirmed native receipt
and bounded read-back of message 5 matched it. The client used only a scoped
gateway token. No raw thread streams, account IDs, tokens or native receipts
are committed as fixtures. Remote tailnet delivery remains unverified.

The real Muse mention/bridge/recorded-reply round trip was subsequently confirmed
locally, as described in [the mention adapter](muse-mentions.md). The selected
next feature is [native draft-time annotations](../research/native-annotations.md),
not timeline-note fallbacks. Native inline creation/replies remain unimplemented.
Automated tests use synthetic data, fake native processes and a fake Muse bridge;
they do not read real threads or send messages to Muse.
