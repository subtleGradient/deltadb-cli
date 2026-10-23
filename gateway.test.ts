import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { Gateway, Journal, changeGrant, readCapabilities, validateListen } from "./gateway";

async function fixture(run: (f: any) => Promise<void>) {
  const dir = await mkdtemp("/tmp/opencode/deltadb-gateway-test-");
  const config = join(dir, "caps.json"), tokenFile = join(dir, "token");
  await changeGrant(config, "synthetic-thread", "north", tokenFile, true);
  const token = (await readFile(tokenFile, "utf8")).trim();
  const journal = await Journal.create(join(dir, "state"), { thread: "synthetic-thread" });
  let calls = 0;
  const backend = { async comment(agent: string, id: string, text: string, before: () => Promise<void>) {
    await before(); calls++; return { disposition: "recorded", sequence: calls, agent, id, textDigest: text.length };
  } };
  const gateway = new Gateway("synthetic-thread", config, true, journal, backend);
  const request = (path: string, body?: any, auth = token) => new Request("http://localhost" + path, {
    method: body ? "POST" : "GET", headers: { authorization: "Bearer " + auth, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  try { await run({ dir, config, tokenFile, token, journal, gateway, request, calls: () => calls }); }
  finally { gateway.disconnected(); await journal.close(); await rm(dir, { recursive: true, force: true }); }
}
async function ready(gateway: Gateway) {
  await gateway.frame({ type: "ready", thread_id: "synthetic-thread" });
  await gateway.frame({ type: "live" });
  await gateway.frame({ type: "item", item: { id: "synthetic-context", kind: "user_message", open: false, content: { text: "synthetic question" } } });
}
const comment = { requestId: "request-1", contextItemId: "synthetic-context", text: "Synthetic bot note" };

test("gateway scopes auth, context, write permission, preview and idempotency", async () => {
  await fixture(async ({ gateway, request, calls, journal }) => {
    expect((await gateway.fetch(new Request("http://localhost/health"))).status).toBe(401);
    expect((await gateway.fetch(request("/health?token=secret"))).status).toBe(400);
    const origin = request("/health"); origin.headers.set("origin", "https://example.com");
    expect((await gateway.fetch(origin)).status).toBe(403);
    expect((await gateway.fetch(request("/comments", comment))).status).toBe(503);
    await ready(gateway);
    const preview = await gateway.fetch(request("/comments", comment));
    expect((await preview.json()).dryRun).toBe(true);
    expect(calls()).toBe(0);
    expect((await gateway.fetch(request("/comments", { ...comment, contextItemId: "other-thread-context" }))).status).toBe(409);
    expect((await gateway.fetch(request("/comments", { ...comment, thread: "other-thread" }))).status).toBe(400);
    const applied = await gateway.fetch(request("/comments", { ...comment, apply: true }));
    expect((await applied.json()).replay).toBe(false);
    expect(calls()).toBe(1);
    const again = await gateway.fetch(request("/comments", { ...comment, apply: true }));
    expect((await again.json()).replay).toBe(true);
    expect(calls()).toBe(1);
    expect((await gateway.fetch(request("/comments", { ...comment, text: "different", apply: true }))).status).toBe(409);
    expect(journal.entries.size).toBe(1);
  });
});

test("revocation closes live streams, read-only agents cannot write, config is owner-only", async () => {
  await fixture(async ({ gateway, request, config, dir, token }) => {
    await ready(gateway);
    await changeGrant(config, "synthetic-thread", "reader", join(dir, "reader-token"), false);
    const readerToken = (await readFile(join(dir, "reader-token"), "utf8")).trim();
    expect((await gateway.fetch(request("/comments", comment, readerToken))).status).toBe(403);
    const response = await gateway.fetch(request("/events"));
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("bounded_recent_events");
    await changeGrant(config, "synthetic-thread", "north");
    await gateway.prune();
    while (!(await reader.read()).done) {} // Drain only previously authorized queued frames.
    expect((await gateway.fetch(request("/health", undefined, token))).status).toBe(401);
    expect((await readCapabilities(config)).grants.length).toBe(1);
    expect(await readFile(config, "utf8")).not.toContain(readerToken);
  });
});

test("unknown append outcomes block that producer across restarts without blocking others", async () => {
  await fixture(async ({ gateway, request, journal, config }) => {
    const broken = new Gateway("synthetic-thread", config, true, journal, {
      async comment(_agent, _id, _text, before) { await before(); throw new Error("receipt lost"); },
    });
    await ready(broken);
    const result = await broken.fetch(request("/comments", { ...comment, apply: true }));
    expect((await result.json()).error).toBe("append_outcome_unknown_reconcile_on_host");
    expect((await broken.fetch(request("/comments", { ...comment, apply: true }))).status).toBe(409);
    expect((await broken.fetch(request("/comments", { ...comment, requestId: "another", apply: true }))).status).toBe(409);
    expect(journal.hasPending("north")).toBe(true);
    broken.disconnected();
  });
  const dir = await mkdtemp("/tmp/opencode/deltadb-gateway-journal-");
  try {
    const j = await Journal.create(dir, { thread: "synthetic" });
    await j.intent("north:request-1", "a".repeat(64)); await j.close();
    const restarted = await Journal.create(dir, { thread: "synthetic" });
    expect(restarted.hasPending("north")).toBe(true); await restarted.close();
    await expect(Journal.create(dir, { thread: "different" })).rejects.toThrow("mismatch");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("gateway refuses disabled writes, malformed input and unsafe network binds", async () => {
  await fixture(async ({ config, journal, request }) => {
    const gateway = new Gateway("synthetic-thread", config, false, journal, { async comment() { throw new Error("Must not write"); } });
    await ready(gateway);
    expect((await gateway.fetch(request("/comments", { ...comment, apply: true }))).status).toBe(403);
    expect((await gateway.fetch(request("/comments", { ...comment, apply: "yes" }))).status).toBe(400);
    expect((await gateway.fetch(request("/comments", { ...comment, text: "a".repeat(17000) }))).status).toBe(400);
    expect(() => validateListen("0.0.0.0", {})).toThrow();
    expect(() => validateListen("192.168.1.2", {})).toThrow();
    expect(() => validateListen("100.64.1.2", {})).toThrow();
    expect(() => validateListen("127.0.0.1", {})).not.toThrow();
    expect(() => validateListen("100.64.1.2", { tailscale0: [{ address: "100.64.1.2" } as any] })).not.toThrow();
    gateway.disconnected();
  });
});

test("quiet event streams receive heartbeat packets without inventing thread/Muse events", async () => {
  await fixture(async ({ gateway, request }) => {
    await ready(gateway);
    await gateway.frame({ type: "item", item: { id: "synthetic-thought", kind: "agent_thought", content: { text: "synthetic reasoning must not be exported" } } });
    const response = await gateway.fetch(request("/events"));
    const reader = response.body!.getReader();
    for (let n = 0; n < 5; n++) {
      const value = await reader.read();
      expect(value.done).toBe(false);
      expect(new TextDecoder().decode(value.value)).not.toContain("synthetic reasoning");
    }
    expect((await gateway.fetch(request("/comments", { ...comment, contextItemId: "synthetic-thought" }))).status).toBe(409);
    await gateway.heartbeat();
    const frame = JSON.parse(new TextDecoder().decode((await reader.read()).value));
    expect(frame.type).toBe("gateway_heartbeat");
    await reader.cancel();
  });
});

test("native inline comment context must match its watched item; revocation before append is fail-closed", async () => {
  await fixture(async ({ gateway, config, journal, request }) => {
    await ready(gateway);
    await gateway.frame({ type: "comment", comment: { id: "comment-root", chain: "comment-root", target: { item_id: "synthetic-context" } } });
    await gateway.frame({ type: "comment", comment: { id: "comment-reply", chain: "comment-root", target: null } });
    const preview = await gateway.fetch(request("/comments", { ...comment, contextCommentId: "comment-reply" }));
    expect(preview.status).toBe(200);
    expect((await preview.json()).text).toContain("Context comment: comment-reply");
    expect((await gateway.fetch(request("/comments", { ...comment, contextCommentId: "unobserved" }))).status).toBe(409);
    const interrupted = new Gateway("synthetic-thread", config, true, journal, { async comment(_agent, _id, _text, before) {
      await changeGrant(config, "synthetic-thread", "north");
      await before(); throw new Error("Must not reach append after revocation");
    } });
    await ready(interrupted);
    const result = await interrupted.fetch(request("/comments", { ...comment, apply: true }));
    expect((await result.json()).error).toBe("native_preflight_failed_no_append");
    expect(journal.entries.size).toBe(0);
    interrupted.disconnected();
  });
});

test("Unix HTTP gateway uses guarded native backend with fake Delta, never client Delta auth", async () => {
  const dir = await mkdtemp("/tmp/opencode/deltadb-gateway-http-");
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const config = join(dir, "caps.json"), tokenFile = join(dir, "token"), socket = join(dir, "gateway.sock");
    await changeGrant(config, "synthetic-thread", "north", tokenFile, true);
    const token = (await readFile(tokenFile, "utf8")).trim();
    const fake = join(dir, "delta"), payload = join(dir, "payload.json");
    await Bun.write(fake, `#!/usr/bin/env bun
const a=process.argv.slice(2), op=a[a.indexOf('thread')+1];
const value=n=>a[a.indexOf('--'+n)+1];
if(op==='watch') {
 for(const f of [{type:'ready',thread_id:'synthetic-thread'},{type:'live'},{type:'item',item:{id:'synthetic-context',kind:'user_message',open:false,content:{text:'test'}}}]) console.log(JSON.stringify(f));
 setInterval(()=>{},1000);
} else if(op==='contract') console.log(JSON.stringify({operation:'contract',min:1,max:7}));
else if(op==='status') console.log(JSON.stringify({operation:'status',thread_id:'synthetic-thread',producer:{source:value('source'),external_id:value('external-id'),next_sequence:1,turn:null}}));
else if(op==='append') {
 const r=JSON.parse(await Bun.stdin.text());
 await Bun.write(process.env.GATEWAY_TEST_PAYLOAD,JSON.stringify(r));
 console.log(JSON.stringify({operation:'appended',thread_id:'synthetic-thread',sequence:r.sequence,next_sequence:r.sequence+1,turn_sequence:null,version:'synthetic.1',duplicate:false,disposition:'recorded'}));
} else process.exit(9);
`);
    await chmod(fake, 0o700);
    child = Bun.spawn([process.execPath, join(import.meta.dir, "deltadb.ts"), "gateway", "serve",
      "--config", config, "--thread", "synthetic-thread", "--database-dir", join(dir, "fake-native-store"),
      "--state", join(dir, "state"), "--socket", socket, "--apply"], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GATEWAY_TEST_PAYLOAD: payload },
      stdin: "ignore", stdout: "ignore", stderr: "pipe",
    });
    let boot = "";
    for await (const chunk of child.stderr as ReadableStream<Uint8Array>) {
      boot += new TextDecoder().decode(chunk);
      if (boot.includes("listening")) break;
    }
    expect(boot).toContain("listening");
    const headers = { authorization: "Bearer " + token };
    let health: any;
    for (let n = 0; n < 100; n++) {
      health = await (await fetch("http://localhost/health", { unix: socket, headers })).json();
      if (health.connected) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(health.connected).toBe(true);
    expect((await fetch("http://localhost/health", { unix: socket })).status).toBe(401);
    const response = await fetch("http://localhost/comments", { unix: socket, method: "POST",
      headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ ...comment, apply: true }) });
    const result = await response.json() as any;
    expect(response.status).toBe(200);
    expect(result.receipt.disposition).toBe("recorded");
    const native = JSON.parse(await readFile(payload, "utf8"));
    expect(native.update.content[0].text).toContain("[Gateway bot: north]");
    expect(native.update.content[0].text).toContain("Context item: synthetic-context");
    expect(native.update.content[0].text).not.toContain(token);
    child.kill("SIGTERM");
    expect(await child.exited).toBe(0); child = undefined;
  } finally {
    if (child) { child.kill(); await child.exited; }
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
