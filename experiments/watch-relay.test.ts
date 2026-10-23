import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm, chmod } from "node:fs/promises";
import { join } from "node:path";
import { relay, Translator, marker, jsonLines, type Config } from "./watch-relay";

const config: Config = { fromPeer: "synthetic-a", fromThread: "source", toThread: "target", apply: false, maxItems: 20 };
const ready = { type: "ready", thread_id: "source" };
const live = { type: "live" };
const item = (text = "synthetic ping", id = "item-1") => ({ type: "item", item: {
  id, kind: "user_message", open: false, content: { text },
} });
async function* lines(frames: unknown[]) { for (const frame of frames) yield JSON.stringify(frame); }

test("watch relay accepts only source-bound finalized user text and labels provenance loss", async () => {
  const translator = new Translator(config);
  expect(() => translator.accept(item())).toThrow("ready");
  expect(() => translator.accept({ ...ready, thread_id: "wrong" })).toThrow("mismatch");
  translator.accept(ready);
  expect(translator.accept(item())).toBeNull();
  translator.accept(live);
  expect(translator.accept({ type: "remove", id: "item-1" })).toBeNull();
  expect(translator.accept({ ...item(), item: { ...item().item, open: true } })).toBeNull();
  expect(translator.accept({ ...item(), item: { ...item().item, kind: "agent_message" } })).toBeNull();
  expect(translator.accept(item(marker + "forwarded] text"))).toBeNull();
  expect(translator.accept(item())!.text).toContain(marker);
  const output: any[] = [];
  await relay(config, lines([ready, live, item(), item()]), async () => { throw new Error("Preview must not submit"); }, x => output.push(x));
  expect(output[0].dryRun).toBe(true);
  expect(output[0].nativeReplication).toBe(false);
  expect(output[1].reason).toBe("already_seen");
  await expect(relay(config, lines([ready, live, item(), item("edited")]), async () => null, () => {})).rejects.toThrow("editing");
});

test("apply journal deduplicates restart and blocks ambiguous delivery/route reuse", async () => {
  const dir = await mkdtemp("/tmp/opencode/deltadb-relay-test-");
  try {
    const applied = { ...config, apply: true, state: join(dir, "success") };
    let count = 0;
    const submit = async () => { count++; return { disposition: "recorded" }; };
    await relay(applied, lines([ready, live, item()]), submit, () => {});
    await relay(applied, lines([ready, live, item()]), submit, () => {});
    expect(count).toBe(1);
    expect(await readFile(join(applied.state, "journal.jsonl"), "utf8")).not.toContain("synthetic ping");
    await expect(relay({ ...applied, toThread: "wrong" }, lines([]), submit, () => {})).rejects.toThrow("different route");
    const pending = { ...applied, state: join(dir, "pending") };
    await expect(relay(pending, lines([ready, live, item()]), async () => { throw new Error("lost receipt"); }, () => {})).rejects.toThrow("lost receipt");
    await expect(relay(pending, lines([ready, live, item()]), submit, () => {})).rejects.toThrow("Pending append");
    expect(count).toBe(1);
    await expect(relay({ ...applied, toThread: "source" }, lines([]), submit, () => {})).rejects.toThrow("Same-thread");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("watch input limits reject invalid/truncated data and message budget overflow", async () => {
  const stream = (text: string) => new Blob([text]).stream();
  const collect = async (text: string) => { const result = []; for await (const line of jsonLines(stream(text))) result.push(line); return result; };
  expect(await collect(JSON.stringify(ready) + "\n")).toEqual([JSON.stringify(ready)]);
  await expect(collect('{"type":"ready"}')).rejects.toThrow("Truncated");
  await expect(collect("x".repeat(1024 * 1024 + 1))).rejects.toThrow("1 MiB");
  await expect(relay(config, lines([]), async () => null, () => {})).rejects.toThrow("handshake");
  await expect(relay({ ...config, maxItems: 1 }, lines([ready, live, item(), item("two", "item-2")]), async () => null, () => {})).rejects.toThrow("budget");
});

test("prototype CLI routes watch text through real wrapper guards using fake Delta only", async () => {
  const dir = await mkdtemp("/tmp/opencode/deltadb-relay-cli-test-");
  try {
    const fake = join(dir, "delta");
    const log = join(dir, "calls.jsonl");
    await Bun.write(fake, `#!/usr/bin/env bun
const a=process.argv.slice(2), action=a[a.indexOf('thread')+1];
const field=n=>a[a.indexOf('--'+n)+1];
const log=process.env.RELAY_TEST_LOG;
await Bun.write(log,(await Bun.file(log).exists()?await Bun.file(log).text():'')+JSON.stringify(a)+'\\n');
if(action==='contract') console.log(JSON.stringify({operation:'contract',min:1,max:7}));
else if(action==='status') console.log(JSON.stringify({operation:'status',thread_id:'target',producer:{source:field('source'),external_id:field('external-id'),next_sequence:1,turn:null}}));
else if(action==='append') {
 const r=JSON.parse(await Bun.stdin.text());
 if(!r.update.content[0].text.startsWith('[deltadb-watch-relay:')) process.exit(8);
 console.log(JSON.stringify({operation:'appended',thread_id:'target',sequence:r.sequence,next_sequence:2,turn_sequence:null,version:'synthetic.1',duplicate:false,disposition:'recorded'}));
} else process.exit(9);
`);
    await chmod(fake, 0o700);
    const run = async (apply: boolean) => {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, "watch-relay.ts"),
        "--from-peer", "synthetic-a", "--from-thread", "source", "--to-thread", "target",
        ...(apply ? ["--apply", "--state", join(dir, "state")] : [])], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, RELAY_TEST_LOG: log },
        stdin: new TextEncoder().encode([ready, live, item()].map(x => JSON.stringify(x)).join("\n") + "\n"),
        stdout: "pipe", stderr: "pipe",
      });
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      return { code, out, err };
    };
    expect((await run(false)).code).toBe(0);
    expect(await Bun.file(log).exists()).toBe(false);
    const result = await run(true);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out.split("\n")[0]).receipt.disposition).toBe("recorded");
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(x => JSON.parse(x));
    expect(calls.map(a => a[a.indexOf("thread") + 1])).toEqual(["status", "contract", "status", "append"]);
    expect(calls[3]).toContain("local");
    await run(true);
    expect((await readFile(log, "utf8")).trim().split("\n").length).toBe(4);
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 30_000);
