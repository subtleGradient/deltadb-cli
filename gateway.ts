import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, lstat, chmod } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { recordNative } from "./recording";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const namePattern = /^[a-zA-Z0-9_-]{1,80}$/;
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
export type Grant = { agent: string; tokenHash: string; comment: boolean };
export type Capabilities = { version: 1; thread: string; grants: Grant[] };
export type Comment = { requestId: string; contextItemId: string; contextCommentId?: string; text: string; apply?: boolean };
type Receipt = { disposition: string; [key: string]: unknown };
export type Backend = {
  comment: (agent: string, messageId: string, text: string, beforeAppend: () => Promise<void>) => Promise<Receipt>;
};

export class GatewayError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

async function privateFile(path: string) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) {
    throw new Error("Owner-only regular file required");
  }
}
async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) {
    throw new Error("Owner-only private directory required");
  }
}
async function syncDirectory(path: string) {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}
export async function readCapabilities(path: string, thread?: string): Promise<Capabilities> {
  await privateFile(path);
  const c = JSON.parse(await readFile(path, "utf8"));
  if (c.version !== 1 || typeof c.thread !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_-]{0,255}$/.test(c.thread) || (thread && c.thread !== thread) ||
      !Array.isArray(c.grants) || c.grants.length > 100 || c.grants.some((g: any) =>
        !g || typeof g.agent !== "string" || !namePattern.test(g.agent) || !/^[0-9a-f]{64}$/.test(g.tokenHash) || typeof g.comment !== "boolean") ||
      new Set(c.grants.map((g: Grant) => g.agent)).size !== c.grants.length ||
      new Set(c.grants.map((g: Grant) => g.tokenHash)).size !== c.grants.length) throw new Error("Invalid gateway capability file/scope");
  return c;
}

/** Owner-side provisioning only. Token plaintext is never stored in the server config. */
export async function changeGrant(config: string, thread: string, agent: string, tokenOut?: string, comment = false) {
  if (!namePattern.test(agent) || !/^[A-Za-z0-9_][A-Za-z0-9_-]{0,255}$/.test(thread)) throw new Error("Invalid agent/thread");
  config = resolve(config);
  await privateDirectory(dirname(config));
  const lock = await open(config + ".lock", "wx", 0o600);
  let temp: string | undefined;
  try {
    let c: Capabilities;
    try { c = await readCapabilities(config, thread); }
    catch (e: any) { if (e.code !== "ENOENT") throw e; c = { version: 1, thread, grants: [] }; }
    if (tokenOut) {
      if (c.grants.length >= 100) throw new Error("Gateway grant limit reached");
      if (c.grants.some(g => g.agent === agent)) throw new Error("Agent exists; revoke before issuing a new token");
      tokenOut = resolve(tokenOut);
      await privateDirectory(dirname(tokenOut));
      const token = randomBytes(32).toString("base64url");
      const out = await open(tokenOut, "wx", 0o600);
      try { await out.writeFile(token + "\n"); await out.sync(); } finally { await out.close(); }
      await syncDirectory(dirname(tokenOut));
      c.grants.push({ agent, tokenHash: sha(token), comment });
    } else {
      if (!c.grants.some(g => g.agent === agent)) throw new Error("Unknown agent");
      c.grants = c.grants.filter(g => g.agent !== agent);
    }
    temp = config + "." + randomUUID() + ".tmp";
    const out = await open(temp, "wx", 0o600);
    try { await out.writeFile(JSON.stringify(c, null, 2) + "\n"); await out.sync(); } finally { await out.close(); }
    await rename(temp, config); temp = undefined;
    await syncDirectory(dirname(config));
  } finally {
    if (temp) await unlink(temp).catch(() => {});
    await lock.close(); await unlink(config + ".lock");
  }
}

export class Journal {
  entries = new Map<string, { digest: string; receipt?: Receipt }>();
  private handle!: Awaited<ReturnType<typeof open>>;
  private lock!: Awaited<ReturnType<typeof open>>;
  private constructor(private dir: string) {}
  static async create(dir: string, identity: unknown) {
    dir = resolve(dir);
    await privateDirectory(dir);
    const journal = new Journal(dir);
    journal.lock = await open(join(dir, "lock"), "wx", 0o600);
    try {
      const expected = JSON.stringify(identity);
      try {
        if ((await readFile(join(dir, "identity.json"), "utf8")) !== expected) throw new Error("Journal route mismatch");
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
        const out = await open(join(dir, "identity.json"), "wx", 0o600);
        try { await out.writeFile(expected); await out.sync(); } finally { await out.close(); }
      }
      let text = "";
      try { text = await readFile(join(dir, "journal.jsonl"), "utf8"); } catch (e: any) { if (e.code !== "ENOENT") throw e; }
      if (text && !text.endsWith("\n")) throw new Error("Truncated journal; manual reconciliation required");
      for (const line of text.split("\n").filter(Boolean)) {
        const e = JSON.parse(line);
        if (e.type === "pending" && typeof e.key === "string" && /^[0-9a-f]{64}$/.test(e.digest) && !journal.entries.has(e.key)) {
          journal.entries.set(e.key, { digest: e.digest });
        } else if (e.type === "recorded" && journal.entries.has(e.key) && !journal.entries.get(e.key)!.receipt && e.receipt?.disposition === "recorded") {
          journal.entries.get(e.key)!.receipt = e.receipt;
        } else throw new Error("Invalid journal; manual reconciliation required");
      }
      journal.handle = await open(join(dir, "journal.jsonl"), "a", 0o600);
      await syncDirectory(dir);
      return journal;
    } catch (e) { await journal.lock.close(); await unlink(join(dir, "lock")); throw e; }
  }
  async intent(key: string, digest: string) {
    await this.handle.writeFile(JSON.stringify({ type: "pending", key, digest }) + "\n");
    await this.handle.sync();
    this.entries.set(key, { digest });
  }
  async recorded(key: string, receipt: Receipt) {
    await this.handle.writeFile(JSON.stringify({ type: "recorded", key, receipt }) + "\n");
    await this.handle.sync();
    this.entries.get(key)!.receipt = receipt;
  }
  hasPending(agent: string) { return [...this.entries].some(([key, value]) => key.startsWith(agent + ":") && !value.receipt); }
  async close() { await this.handle.close(); await this.lock.close(); await unlink(join(this.dir, "lock")); }
}

type Subscriber = { hash: string; controller: ReadableStreamDefaultController<Uint8Array> };
export class Gateway {
  connected = false;
  private ready = false;
  private items = new Set<string>();
  private comments = new Map<string, string>();
  private frames: string[] = [];
  private clients = new Set<Subscriber>();
  private queue = Promise.resolve();
  private queued = 0;
  readonly instance = randomUUID();
  constructor(readonly thread: string, private config: string, private apply: boolean,
    private journal: Journal, private backend: Backend) {}
  private caps() { return readCapabilities(this.config, this.thread); }
  private drop(s: Subscriber) { this.clients.delete(s); try { s.controller.close(); } catch {} }
  async prune() {
    try {
      const c = await this.caps();
      for (const s of this.clients) if (!c.grants.some(g => g.tokenHash === s.hash)) this.drop(s);
    } catch { for (const s of this.clients) this.drop(s); }
  }
  async heartbeat() {
    await this.prune();
    const data = new TextEncoder().encode(JSON.stringify({ type: "gateway_heartbeat", instance: this.instance }) + "\n");
    for (const s of this.clients) {
      if ((s.controller.desiredSize ?? 0) < data.byteLength) this.drop(s);
      else { try { s.controller.enqueue(data); } catch { this.drop(s); } }
    }
  }
  async frame(frame: any) {
    if (!frame || typeof frame !== "object") throw new Error("Invalid native watch frame");
    if (frame.type === "item" && ["agent_thought", "reasoning", "thinking"].includes(frame.item?.kind)) return;
    if (frame.type === "ready") {
      if (frame.thread_id !== this.thread || this.ready) throw new Error("Native watch thread mismatch/repeated ready");
      this.ready = true;
    } else if (!this.ready) throw new Error("Missing native watch ready");
    if (frame.type === "live") this.connected = true;
    if (frame.type === "error") throw new Error("Native watch error");
    if (frame.type === "item" && typeof frame.item?.id === "string") {
      if (frame.item.id.length > 256) throw new Error("Native item ID limit");
      this.items.add(frame.item.id);
      if (this.items.size > 200) this.items.delete(this.items.values().next().value!);
    }
    if (frame.type === "comment" && typeof frame.comment?.id === "string") {
      const c = frame.comment;
      if (c.id.length > 256) throw new Error("Native comment ID limit");
      const item = c.target?.item_id ?? this.comments.get(c.chain);
      if (typeof item === "string" && item.length <= 256) this.comments.set(c.id, item);
      if (this.comments.size > 200) this.comments.delete(this.comments.keys().next().value!);
    }
    if (typeof frame.type === "string" && frame.type.includes("remove")) { this.items.clear(); this.comments.clear(); }
    const data = JSON.stringify({ type: "delta", event: frame }) + "\n";
    if (Buffer.byteLength(data) > 1024 * 1024) throw new Error("Native frame too large");
    this.frames.push(data);
    if (this.frames.length > 100) this.frames.shift();
    // Cap total retained event bytes, not only the number of events.
    while (this.frames.reduce((n, f) => n + Buffer.byteLength(f), 0) > 2 * 1024 * 1024) this.frames.shift();
    await this.prune();
    for (const s of this.clients) {
      if ((s.controller.desiredSize ?? 0) <= 0) this.drop(s);
      else { try { s.controller.enqueue(new TextEncoder().encode(data)); } catch { this.drop(s); } }
    }
  }
  disconnected() {
    this.connected = false; this.items.clear(); this.comments.clear(); this.frames = [];
    for (const s of this.clients) this.drop(s);
  }
  async stop() { this.disconnected(); await this.queue; }
  private async principal(request: Request): Promise<Grant> {
    if (request.headers.has("origin")) throw new GatewayError(403, "browser_origin_refused");
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!token) throw new GatewayError(401, "gateway_token_required");
    const digest = Buffer.from(sha(token), "hex");
    const grant = (await this.caps()).grants.find(g => timingSafeEqual(Buffer.from(g.tokenHash, "hex"), digest));
    if (!grant) throw new GatewayError(401, "invalid_or_revoked_gateway_token");
    return grant;
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.search) throw new GatewayError(400, "query_parameters_refused");
      const grant = await this.principal(request);
      if (request.method === "GET" && url.pathname === "/health") return Response.json({ thread: this.thread, connected: this.connected, writesEnabled: this.apply, agent: grant.agent }, { headers: { "cache-control": "no-store" } });
      if (request.method === "GET" && url.pathname === "/events") {
        if (!this.connected) throw new GatewayError(503, "native_watch_unavailable");
        if (this.clients.size >= 32) throw new GatewayError(429, "subscriber_limit");
        let subscriber: Subscriber;
        const stream = new ReadableStream<Uint8Array>({
          start: controller => {
            subscriber = { hash: grant.tokenHash, controller };
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: "gateway", thread: this.thread,
              instance: this.instance, replay: "bounded_recent_events_not_full_history", nativeInlineComments: false }) + "\n"));
            for (const frame of this.frames) controller.enqueue(new TextEncoder().encode(frame));
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: "gateway_live", instance: this.instance }) + "\n"));
            this.clients.add(subscriber);
          },
          cancel: () => { this.clients.delete(subscriber); },
        }, { highWaterMark: 2 * 1024 * 1024 + 4096, size: chunk => chunk.byteLength });
        const abort = () => this.drop(subscriber);
        request.signal.addEventListener("abort", abort, { once: true });
        return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
      }
      if (request.method === "POST" && url.pathname === "/comments") {
        if (!grant.comment) throw new GatewayError(403, "comment_permission_required");
        const contentType = request.headers.get("content-type")?.split(";")[0].trim();
        if (contentType !== "application/json") throw new GatewayError(415, "json_required");
        const bytes: Uint8Array[] = []; let length = 0;
        if (!request.body) throw new GatewayError(400, "comment_required");
        for await (const chunk of request.body) {
          length += chunk.byteLength;
          if (length > 32 * 1024) throw new GatewayError(413, "comment_too_large");
          bytes.push(chunk);
        }
        let body: any;
        try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(bytes))); }
        catch { throw new GatewayError(400, "invalid_json_utf8"); }
        return Response.json(await this.comment(grant, body), { headers: { "cache-control": "no-store" } });
      }
      throw new GatewayError(404, "not_found");
    } catch (e) {
      const error = e instanceof GatewayError ? e : new GatewayError(503, "gateway_dependency_unavailable");
      return Response.json({ error: error.code }, { status: error.status, headers: { "cache-control": "no-store" } });
    }
  }
  async comment(grant: Grant, body: Comment) {
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some(k => !["requestId", "contextItemId", "contextCommentId", "text", "apply"].includes(k)) ||
      typeof body.requestId !== "string" || !idPattern.test(body.requestId) ||
      typeof body.contextItemId !== "string" || !body.contextItemId || body.contextItemId.length > 256 || /[\r\n]/.test(body.contextItemId) ||
      (body.contextCommentId !== undefined && (typeof body.contextCommentId !== "string" || !body.contextCommentId || body.contextCommentId.length > 256 || /[\r\n]/.test(body.contextCommentId))) ||
      typeof body.text !== "string" || !body.text.trim() || Buffer.byteLength(body.text) > 16 * 1024 ||
      (body.apply !== undefined && typeof body.apply !== "boolean")) throw new GatewayError(400, "invalid_comment");
    const note = `[Gateway bot: ${grant.agent}]\nContext item: ${body.contextItemId}\n${body.contextCommentId ? `Context comment: ${body.contextCommentId}\n` : ""}Request: ${body.requestId}\n\n${body.text}`;
    const digest = sha(JSON.stringify([body.contextItemId, body.contextCommentId ?? null, body.text]));
    const key = `${grant.agent}:${body.requestId}`;
    const execute = async () => {
      // Recheck revocation after waiting in the serialized write queue.
      const current = (await this.caps()).grants.find(g => g.agent === grant.agent && g.tokenHash === grant.tokenHash);
      if (!current?.comment) throw new GatewayError(403, "comment_permission_revoked");
      const previous = this.journal.entries.get(key);
      if (previous) {
        if (previous.digest !== digest) throw new GatewayError(409, "request_id_content_mismatch");
        if (!previous.receipt) throw new GatewayError(409, "pending_outcome_reconcile_on_host");
        return { operation: "comment_recorded", replay: true, receipt: previous.receipt };
      }
      if (!this.connected) throw new GatewayError(503, "native_watch_unavailable");
      if (!this.items.has(body.contextItemId)) throw new GatewayError(409, "context_not_in_recent_watch");
      if (body.contextCommentId && this.comments.get(body.contextCommentId) !== body.contextItemId) throw new GatewayError(409, "comment_context_not_in_recent_watch");
      if (!body.apply) return { dryRun: true, operation: "timeline_note", nativeInlineComment: false, agent: grant.agent, text: note };
      if (!this.apply) throw new GatewayError(403, "server_write_mode_disabled");
      if (this.journal.hasPending(grant.agent)) throw new GatewayError(409, "producer_has_pending_outcome");
      try {
        const receipt = await this.backend.comment(grant.agent, `gateway-${sha(key)}`, note,
          async () => {
            const stillGranted = (await this.caps()).grants.some(g => g.agent === grant.agent && g.tokenHash === grant.tokenHash && g.comment);
            if (!this.connected || !stillGranted) throw new Error("Access/watch changed before append");
            await this.journal.intent(key, digest);
          });
        if (receipt.disposition !== "recorded" || !this.journal.entries.has(key)) throw new Error("Unconfirmed append");
        await this.journal.recorded(key, receipt);
        return { operation: "comment_recorded", replay: false, receipt };
      } catch {
        throw new GatewayError(502, this.journal.entries.has(key) ? "append_outcome_unknown_reconcile_on_host" : "native_preflight_failed_no_append");
      }
    };
    if (this.queued >= 16) throw new GatewayError(429, "write_queue_full");
    this.queued++;
    const result = this.queue.then(execute);
    this.queue = result.then(() => {}, () => {});
    try { return await result; } finally { this.queued--; }
  }
}

async function nativeCapture(command: string[], input?: string): Promise<string> {
  const child = Bun.spawn(command, { stdin: input === undefined ? "ignore" : new TextEncoder().encode(input), stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill("SIGTERM"), 30_000);
  try {
    const [out, , code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error("Native command failed");
    return out;
  } finally { clearTimeout(timer); }
}
export function nativeBackend(thread: string, databaseDir: string): Backend {
  const prefix = ["delta", "--json", "--database-dir", databaseDir];
  return { async comment(agent, messageId, text, beforeAppend) {
    const source = "deltadb-gateway";
    const externalId = sha(JSON.stringify([thread, agent]));
    const status = JSON.parse(await nativeCapture([...prefix, "thread", "status", "--source", source, "--external-id", externalId, thread]));
    let receipt: Receipt | undefined;
    await recordNative("message", new Map(Object.entries({ thread, source, "external-id": externalId,
      "database-dir": databaseDir, sequence: String(status.producer?.next_sequence),
      "message-id": messageId, text, acknowledge: "server", apply: "true" })), {
      capture: nativeCapture, beforeAppend, output: value => { receipt = value; },
    });
    return receipt!;
  } };
}

async function watch(thread: string, databaseDir: string, gateway: Gateway) {
  const child = Bun.spawn(["delta", "--json", "--database-dir", databaseDir, "thread", "watch", thread], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const run = async () => {
    const decoder = new TextDecoder("utf-8", { fatal: true }); let buffer = "";
    try {
      for await (const chunk of child.stdout) {
        buffer += decoder.decode(chunk, { stream: true });
        let index: number;
        while ((index = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          if (Buffer.byteLength(line) > 1024 * 1024) throw new Error("Watch frame limit");
          if (line.trim()) await gateway.frame(JSON.parse(line));
        }
        if (Buffer.byteLength(buffer) > 1024 * 1024) throw new Error("Watch frame limit");
      }
    } finally { gateway.disconnected(); child.kill(); await child.exited; }
  };
  const done = run().catch(() => { console.error("gateway: native watch disconnected; no automatic restart"); });
  return { stop: () => child.kill(), done };
}

export function validateListen(host: string, interfaces = networkInterfaces()) {
  if (host === "127.0.0.1") return;
  const octets = host.split(".").map(Number);
  const tailnet = octets.length === 4 && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255);
  const assigned = Object.entries(interfaces).some(([name, addresses]) => name.startsWith("tailscale") && addresses?.some(a => a.address === host));
  if (!tailnet || !assigned) throw new Error("Bind only to 127.0.0.1 or an assigned tailscale interface IPv4; never wildcard/LAN/public");
}

export const gatewayUsage = `Scoped thread gateway (host uses its Delta login; clients use revocable gateway tokens):
  deltadb gateway grant --config PRIVATE_FILE --thread ID --agent NAME --token-out PRIVATE_FILE [--comment]
  deltadb gateway revoke --config PRIVATE_FILE --thread ID --agent NAME
  deltadb gateway serve --config PRIVATE_FILE --thread ID --database-dir DIR --state PRIVATE_DIR
    (--socket PRIVATE_PATH | --listen 127.0.0.1:PORT | --listen TAILSCALE_IPV4:PORT) [--apply]
Serve is preview-only for writes unless --apply. Client comment requests also need
apply:true. Read-only grants can watch but cannot comment. Comments are attributed
timeline text notes referencing observed item IDs, NOT native inline annotations.
No listener is installed/autostarted. No Delta credentials are sent to clients.`;

export async function runGateway(args: string[]) {
  if (!args.length || args.includes("--help")) { console.log(gatewayUsage); return; }
  const [action, ...rest] = args;
  const fields: Record<string, string[]> = {
    grant: ["config", "thread", "agent", "token-out", "comment"], revoke: ["config", "thread", "agent"],
    serve: ["config", "thread", "database-dir", "state", "socket", "listen", "apply"],
  };
  if (!fields[action]) throw new Error("Unknown gateway action");
  const o = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i].slice(2);
    if (!rest[i].startsWith("--") || !fields[action].includes(key) || o.has(key)) throw new Error("Invalid/duplicate gateway option");
    if (["comment", "apply"].includes(key)) o.set(key, "true");
    else { const value = rest[++i]; if (!value || value.startsWith("--")) throw new Error("Missing gateway option value"); o.set(key, value); }
  }
  const required = (key: string) => { const value = o.get(key); if (!value) throw new Error(`Missing --${key}`); return value; };
  const config = resolve(required("config")), thread = required("thread");
  if (action !== "serve") {
    await changeGrant(config, thread, required("agent"), action === "grant" ? required("token-out") : undefined, o.has("comment"));
    console.log(JSON.stringify({ operation: action, agent: required("agent"), tokenPrinted: false })); return;
  }
  await readCapabilities(config, thread);
  if (o.has("socket") === o.has("listen")) throw new Error("Choose exactly one --socket or --listen");
  let host: string | undefined, port: number | undefined, socket: string | undefined;
  if (o.has("listen")) {
    const m = /^(\d+\.\d+\.\d+\.\d+):(\d+)$/.exec(required("listen"));
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 65535) throw new Error("Invalid listen address");
    host = m[1]; port = Number(m[2]); validateListen(host);
  } else {
    socket = resolve(required("socket"));
    await privateDirectory(dirname(socket));
    try { await lstat(socket); throw new Error("Socket path already exists; not replacing it"); } catch (e: any) { if (e.code !== "ENOENT") throw e; }
  }
  const databaseDir = resolve(required("database-dir"));
  const journal = await Journal.create(required("state"), { version: 1, thread, databaseDir });
  const gateway = new Gateway(thread, config, o.has("apply"), journal, nativeBackend(thread, databaseDir));
  let server: ReturnType<typeof Bun.serve> | undefined;
  let watcher: Awaited<ReturnType<typeof watch>> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let socketCreated = false;
  try {
    const options = { fetch: (r: Request) => gateway.fetch(r), idleTimeout: 0 as const, maxRequestBodySize: 32 * 1024 };
    server = socket ? Bun.serve({ ...options, unix: socket }) : Bun.serve({ ...options, hostname: host, port });
    socketCreated = Boolean(socket);
    if (socket) await chmod(socket, 0o600);
    watcher = await watch(thread, databaseDir, gateway);
    let ticks = 0;
    timer = setInterval(() => { void (++ticks % 15 === 0 ? gateway.heartbeat() : gateway.prune()); }, 1000);
    let stop!: () => void;
    const stopped = new Promise<void>(resolve => { stop = resolve; });
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    console.error("gateway: listening; tokens required; timeline notes only; native connection reported by /health");
    await stopped;
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
  } finally {
    if (timer) clearInterval(timer);
    watcher?.stop(); await watcher?.done;
    server?.stop(true); await gateway.stop();
    await journal.close();
    if (socketCreated) await unlink(socket!).catch(() => {});
  }
}
