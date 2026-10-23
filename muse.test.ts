import { test, expect } from "bun:test";
import { mkdtemp, rm, chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { MuseMentions, validateGatewayURL, type MentionConfig } from "./muse";

const item = (text = "@North please review this", id = "synthetic-message") => ({ type: "delta", event: { type: "item", item: {
  id, kind: "user_message", open: false, author: { user_id: "synthetic-owner" }, content: { text },
} } });
const comment = (text = "@Muse thoughts?", id = "synthetic-comment") => ({ type: "delta", event: { type: "comment", comment: {
  id, chain: "synthetic-comment", agent: false, author: { user_id: "synthetic-owner" }, text, target: { item_id: "synthetic-message", kind: "transcript", quote: "this" },
} } });
const live = { type: "gateway_live" };

test("Muse ignores snapshots, unmentioned events, other authors and bot echoes; only owner mentions send", async () => {
  const dir = await mkdtemp("/tmp/opencode/deltadb-muse-test-");
  let asks = 0; const comments: any[] = [];
  const config: MentionConfig = { ownerUserId: "synthetic-owner", mentions: ["North", "Muse"], apply: true, state: dir, scope: "synthetic-route" };
  let adapter = await MuseMentions.create(config, {
    ask: async () => { asks++; return "Synthetic Muse feedback"; }, comment: async body => { comments.push(body); return { receipt: "synthetic" }; },
  });
  try {
    expect((await adapter.event(item())).operation).toBe("ignored");
    await adapter.event(comment()); // Historical inline mention is not a summons.
    await adapter.event(live);
    await adapter.event(comment()); // Duplicate baseline event is still historical after live.
    for (let n = 0; n < 100; n++) await adapter.event(item("ordinary unmentioned event", "ignored-" + n));
    await adapter.event(item("email somebody@north.example"));
    await adapter.event(item("[Gateway bot: north]\n@North reply"));
    await adapter.event({ type: "delta", event: { type: "comment", comment: { ...comment().event.comment, id: "draft-comment", in_progress: true } } });
    await adapter.event({ ...item(), event: { type: "item", item: { ...item().event.item, author: { user_id: "not-owner" } } } });
    expect(asks).toBe(0);
    expect((await adapter.event(comment("@Muse thoughts?", "live-comment"))).operation).toBe("muse_commented");
    expect(asks).toBe(1);
    expect(comments[0].contextItemId).toBe("synthetic-message");
    expect(comments[0].contextCommentId).toBe("live-comment");
    expect(comments[0].text).toBe("Synthetic Muse feedback");
    expect((await adapter.event(comment("@Muse thoughts?", "live-comment"))).operation).toBe("already_answered");
    await adapter.close();
    adapter = await MuseMentions.create(config, { ask: async () => { throw new Error("Must never resend"); }, comment: async () => null });
    await adapter.event(live);
    expect((await adapter.event(comment("@Muse thoughts?", "live-comment"))).operation).toBe("already_answered");
    await expect(adapter.event(comment("@Muse changed request", "live-comment"))).rejects.toThrow("changed");
  } finally { await adapter.close(); await rm(dir, { recursive: true, force: true }); }
});

test("Muse preview and ambiguous delivery do not cause automatic requests/retries", async () => {
  const dir = await mkdtemp("/tmp/opencode/deltadb-muse-failure-");
  const config: MentionConfig = { ownerUserId: "synthetic-owner", mentions: ["North"], apply: false, state: dir, scope: "synthetic-route" };
  let asks = 0;
  const deps = { ask: async () => { asks++; throw new Error("delivery unknown"); }, comment: async () => null };
  let adapter = await MuseMentions.create(config, deps);
  try {
    await adapter.event(live);
    expect((await adapter.event(item())).dryRun).toBe(true);
    expect(asks).toBe(0);
    await adapter.close();
    adapter = await MuseMentions.create({ ...config, apply: true }, deps);
    await adapter.event(live);
    await expect(adapter.event(item())).rejects.toThrow("delivery unknown");
    await expect(adapter.event(item())).rejects.toThrow("No automatic resend");
    expect(asks).toBe(1);
    expect(() => validateGatewayURL("http://public.example")).toThrow();
    expect(() => validateGatewayURL("http://100.64.1.2:8787")).not.toThrow();
    expect(() => validateGatewayURL("https://user:password@example.com")).toThrow();
  } finally { await adapter.close(); await rm(dir, { recursive: true, force: true }); }
});

test("Muse CLI calls fake north-message once for a new owner comment and posts same-context reply", async () => {
  const dir = await mkdtemp("/tmp/opencode/deltadb-muse-cli-");
  let posted: any;
  const token = "A".repeat(43);
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    expect(request.headers.get("authorization")).toBe("Bearer " + token);
    if (new URL(request.url).pathname === "/events") {
      // Keep the response genuinely live: finite fixtures hide one-shot AbortError cleanup bugs.
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode([
          { type: "gateway", instance: "synthetic" }, item(), comment(), live, comment("@North review live comment", "live-comment"),
        ].map(x => JSON.stringify(x)).join("\n") + "\n"));
      } }));
    }
    posted = await request.json();
    return Response.json({ operation: "comment_recorded", receipt: { disposition: "recorded" } });
  } });
  try {
    const bridge = join(dir, "north-message"), tokenFile = join(dir, "token");
    await Bun.write(tokenFile, token + "\n"); await chmod(tokenFile, 0o600);
    await Bun.write(bridge, `#!/usr/bin/env bun
const prompt=await Bun.stdin.text();
await Bun.write(process.env.MUSE_TEST_PROMPT,prompt);
console.log('Synthetic North reply');
`);
    await chmod(bridge, 0o700);
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "deltadb.ts"), "muse", "listen",
      "--url", `http://127.0.0.1:${server.port}`, "--token-file", tokenFile, "--owner-user-id", "synthetic-owner",
      "--bridge", bridge, "--state", join(dir, "state"), "--once", "--apply"], {
      env: { ...process.env, MUSE_TEST_PROMPT: join(dir, "prompt") }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(err).toBe(""); expect(code).toBe(0);
    expect(JSON.parse(out).operation).toBe("muse_commented");
    expect(posted.contextCommentId).toBe("live-comment");
    expect(posted.contextItemId).toBe("synthetic-message");
    expect(posted.text).toBe("Synthetic North reply\n");
    expect(await readFile(join(dir, "prompt"), "utf8")).toContain("@North review live comment");
    expect(await readFile(join(dir, "prompt"), "utf8")).not.toContain("@Muse thoughts?");
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
}, 30_000);
