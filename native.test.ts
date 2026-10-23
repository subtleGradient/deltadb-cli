import { test, expect } from "bun:test";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { join } from "node:path";

test("native routing and guards without accessing an account or real messages", async () => {
  const dir = await mkdtemp("/tmp/opencode/deltadb-native-test-");
  try {
    const fake = join(dir, "delta");
    await Bun.write(fake, '#!/usr/bin/env bun\nconsole.log(JSON.stringify(process.argv.slice(2)));\n');
    await chmod(fake, 0o700);
    const run = async (...args: string[]) => {
      const child = Bun.spawn(["bun", join(import.meta.dir, "deltadb.ts"), ...args], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, stdout: "pipe", stderr: "pipe",
      });
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      return { code, out, err };
    };
    const list = await run("threads", "list", "--database-dir", "/example/store");
    expect(list.code).toBe(0);
    expect(JSON.parse(list.out)).toEqual(["--json", "--database-dir", "/example/store", "thread", "list"]);
    expect(JSON.parse((await run("threads", "get", "--thread", "test-id")).out)).toEqual(["--json", "thread", "show", "test-id"]);
    expect(JSON.parse((await run("thread", "watch", "--thread", "synthetic-id", "--database-dir", "/example/store")).out))
      .toEqual(["--json", "--database-dir", "/example/store", "thread", "watch", "synthetic-id"]);
    const sync = await run("thread", "sync", "--thread", "synthetic-id");
    expect(JSON.parse(sync.out).dryRun).toBe(true);
    expect(JSON.parse(sync.out).command).toEqual(["delta", "--json", "thread", "sync", "synthetic-id"]);
    expect(JSON.parse((await run("threads", "sync", "--thread", "synthetic-id", "--apply")).out))
      .toEqual(["--json", "thread", "sync", "synthetic-id"]);
    for (const args of [["thread", "watch", "--apply"], ["thread", "sync"],
      ["thread", "sync", "--thread", "synthetic-id", "--transport", "ssh://peer"],
      ["thread", "watch", "--thread", "synthetic-id", "--source", "other-producer"]]) {
      expect((await run(...args)).code).toBe(1);
    }
    const create = ["threads", "create", "--source", "test", "--external-id", "example"];
    expect(JSON.parse((await run(...create)).out).dryRun).toBe(true);
    expect(JSON.parse((await run(...create, "--apply")).out)).toEqual(["--json", "thread", "create", "--source", "test", "--external-id", "example"]);
    expect((await run(...create, "--name", "root")).code).toBe(1);
    expect((await run("threads", "create", "--source", "test", "--apply")).code).toBe(1);
    expect(JSON.parse((await run("threads", "delete", "--thread", "test-id")).out)).toEqual(["--json", "thread", "delete", "test-id"]);
    expect(JSON.parse((await run("threads", "delete", "--thread", "test-id", "--apply")).out)).toContain("--force");
    expect(JSON.parse((await run("messages", "list", "--thread", "test-id", "--range", "1-20")).out)).toEqual(["--json", "thread", "show", "test-id", "--format", "messages", "--messages", "1-20"]);
    expect((await run("messages", "list", "--thread", "test-id", "--range", "1-21")).code).toBe(1);
    expect((await run("messages", "list", "--thread", "test-id", "--range", "0-2")).code).toBe(1);
    expect((await run("threads", "list", "--db", "file.sqlite")).code).toBe(1);
    expect((await run("threads", "list", "--apply")).code).toBe(1);
    for (const [group, action] of [["messages", "update"], ["messages", "delete"]]) {
      const result = await run(group, action, "--thread", "test-id", "--apply");
      expect(result.code).toBe(1);
      expect(result.out).toBe("");
      expect(result.err).toContain("Unsupported native mutation");
    }
    await Bun.write(fake, '#!/usr/bin/env bash\nexit 7\n');
    expect((await run("threads", "list")).err).toContain("status 7");
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 30_000);

test("stdin text previews are UTF-8 bounded data, not shell commands or implicit writes", async () => {
  const run = async (input: Uint8Array, extra: string[] = []) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "deltadb.ts"), "messages", "create",
      "--thread", "synthetic-thread", "--source", "synthetic-tool", "--external-id", "synthetic-session",
      "--sequence", "1", "--message-id", "synthetic-message", "--text-stdin", ...extra], {
      env: { ...process.env, PATH: "/nonexistent" }, stdin: input, stdout: "pipe", stderr: "pipe",
    });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, out, err };
  };
  const text = "Unicode 🦉\n$(not-a-command) 'quoted'";
  const preview = await run(new TextEncoder().encode(text));
  expect(preview.code).toBe(0);
  expect(JSON.parse(preview.out).record.update.content[0].text).toBe(text);
  expect(JSON.parse(preview.out).dryRun).toBe(true);
  expect((await run(new Uint8Array())).code).toBe(1);
  expect((await run(new Uint8Array([0xff]))).code).toBe(1);
  expect((await run(new TextEncoder().encode("one"), ["--text", "two"])).err).toContain("not both");
  expect((await run(new Uint8Array(16 * 1024 * 1024 + 1).fill(97))).err).toContain("16 MiB");
  expect((await run(new TextEncoder().encode("one"), ["--text-stdin=true"])).code).toBe(1);
}, 30_000);
