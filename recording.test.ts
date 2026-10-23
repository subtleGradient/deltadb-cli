import { test, expect } from "bun:test";
import { buildRecord } from "./recording";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { join } from "node:path";

test("sourced text/title builders validate without inventing turn starts", () => {
  const options = new Map(Object.entries({ sequence: "1", "message-id": "example-1", text: "hello" }));
  expect(buildRecord("message", options)).toEqual({ schemaVersion: 1, sequence: 1,
    update: { sessionUpdate: "user_message", messageId: "example-1", content: [{ type: "text", text: "hello" }] } });
  expect(buildRecord("title", new Map([["sequence", "1"], ["title", "Example"]])).update).toEqual({ sessionUpdate: "session_info_update", title: "Example" });
  for (const sequence of ["0", "-1", "1.5", "9007199254740992", "1e2"]) {
    expect(() => buildRecord("message", new Map([...options, ["sequence", sequence]]))).toThrow();
  }
  expect(() => buildRecord("message", new Map([...options, ["role", "system"]]))).toThrow();
  expect(() => buildRecord("message", new Map([...options, ["role", "assistant"]]))).toThrow();
  expect(() => buildRecord("message", new Map([...options, ["turn-sequence", "1"]]))).toThrow();
  expect(() => buildRecord("title", new Map([["sequence", "1"], ["title", "\nBad"]]))).toThrow();
});

test("typed append verifies contract, identity, sequence, turn and receipt with a fake Delta", async () => {
  const dir = await mkdtemp("/tmp/opencode/deltadb-recording-test-");
  try {
    const fake = join(dir, "delta");
    await Bun.write(fake, `#!/usr/bin/env bun
const args = process.argv.slice(2), mode = process.env.PROBE_MODE;
const action = args[args.indexOf('thread')+1];
await Bun.write(process.env.PROBE_LOG, (await Bun.file(process.env.PROBE_LOG).exists() ? await Bun.file(process.env.PROBE_LOG).text() : '') + action + '\\n');
if(action==='contract') console.log(JSON.stringify({operation:'contract',min:mode==='new-contract'?8:1,max:mode==='new-contract'?8:7}));
else if(action==='status') console.log(JSON.stringify({operation:'status',thread_id:'synthetic-thread',producer:{source:mode==='wrong-source'?'other':'test',external_id:'synthetic-producer',next_sequence:mode==='wrong-sequence'?99:(mode==='scoped'?2:1),turn:mode==='scoped'||mode==='running'?{sequence:1,status:'running'}:null}}));
else if(action==='append') {
  const record=JSON.parse(await Bun.stdin.text());
  if(mode==='process-error') {console.error('synthetic failure');process.exit(7);}
  console.log(JSON.stringify({operation:'appended',thread_id:mode==='bad-receipt'?'wrong':'synthetic-thread',sequence:record.sequence,next_sequence:record.sequence+1,turn_sequence:record.turnSequence??null,version:'synthetic.1',duplicate:mode==='duplicate',disposition:mode==='fenced'?'fenced':mode==='duplicate'?'duplicate':'recorded'}));
} else process.exit(9);
`);
    await chmod(fake, 0o700);
    const base = ["--thread", "synthetic-thread", "--source", "test", "--external-id", "synthetic-producer", "--sequence", "1"];
    const run = async (mode: string, args: string[]) => {
      const log = join(dir, "calls");
      await Bun.write(log, "");
      const child = Bun.spawn(["bun", join(import.meta.dir, "deltadb.ts"), ...args], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, PROBE_MODE: mode, PROBE_LOG: log }, stdout: "pipe", stderr: "pipe",
      });
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      return { code, out, err, calls: await Bun.file(log).text() };
    };
    const create = ["messages", "create", ...base, "--message-id", "test-message", "--text", "hello"];
    const preview = await run("good", create);
    expect(preview.code).toBe(0);
    expect(preview.calls).toBe("");
    expect(JSON.parse(preview.out).record.update.sessionUpdate).toBe("user_message");
    const applied = await run("good", [...create, "--apply"]);
    expect(applied.code).toBe(0);
    expect(applied.calls).toBe("contract\nstatus\nappend\n");
    expect(JSON.parse(applied.out).disposition).toBe("recorded");
    for (const mode of ["new-contract", "wrong-source", "wrong-sequence", "running"]) {
      const blocked = await run(mode, [...create, "--apply"]);
      expect(blocked.code).toBe(1);
      expect(blocked.calls).not.toContain("append");
    }
    for (const mode of ["bad-receipt", "fenced", "duplicate", "process-error"]) {
      const result = await run(mode, [...create, "--apply"]);
      expect(result.code).toBe(1);
      expect(result.calls).toBe("contract\nstatus\nappend\n");
    }
    const title = await run("good", ["threads", "update", ...base, "--title", "New title", "--apply"]);
    expect(title.code).toBe(0);
    const scopedBase = base.map((v,i) => i===7 ? "2" : v);
    const scoped = await run("scoped", ["messages", "create", ...scopedBase, "--message-id", "reply", "--text", "reply", "--role", "assistant", "--turn-sequence", "1", "--apply"]);
    expect(scoped.code).toBe(0);
    expect(JSON.parse(scoped.out).turn_sequence).toBe(1);
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 30_000);
