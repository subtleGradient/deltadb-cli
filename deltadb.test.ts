import { test, expect } from "bun:test";
import { SQL } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

const cli = join(import.meta.dir, "deltadb.ts");
async function run(...args: string[]) {
  const child = Bun.spawn(["bun", cli, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, stdout, stderr };
}

test("phase 1: read arbitrary SQLite without allowing mutations or implicit creation", async () => {
  const dir = await mkdtemp("/tmp/opencode/deltadb-read-");
  try {
    const path = join(dir, "existing.sqlite");
    const db = new SQL({ adapter: "sqlite", filename: path });
    await db.unsafe("CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)");
    await db.unsafe("INSERT INTO sample VALUES (1, 'hello')");
    await db.close();
    expect((await run("tables", "--db", path)).stdout).toContain("sample");
    expect((await run("schema", "--db", path, "--table", "sample")).stdout).toContain("CREATE TABLE");
    expect(JSON.parse((await run("rows", "--db", path, "--table", "sample")).stdout)).toEqual([{ id: 1, value: "hello" }]);
    expect(JSON.parse((await run("query", "--db", path, "--sql", "SELECT value FROM sample WHERE id=?", "--params", "[1]")).stdout)).toEqual([{ value: "hello" }]);
    expect((await run("query", "--db", path, "--sql", "WITH x AS (SELECT 1) DELETE FROM sample")).code).toBe(1);
    expect((await run("query", "--db", path, "--sql", "SELECT 1; DELETE FROM sample")).code).toBe(1);
    expect((await run("rows", "--db", path, "--table", "sample", "--limit", "-1")).code).toBe(1);
    expect((await run("query", "--db", join(dir, "missing"), "--sql", "SELECT 1")).code).toBe(1);
    expect(await Bun.file(join(dir, "missing")).exists()).toBe(false);
    expect((await run("insert", "--db", path, "--table", "sample", "--values", '{"id":2}', "--apply")).stderr).toContain("restricted");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("phase 2: sandbox init, preview, insert, update, delete and rollback", async () => {
  const dir = await mkdtemp("/tmp/opencode/deltadb-write-");
  try {
    const path = join(dir, "sandbox.sqlite");
    const init = await run("init", "--db", path);
    expect(init.stderr).toBe("");
    expect(init.code).toBe(0);
    expect(JSON.parse(init.stdout).appReady).toBe(false);
    const tables = JSON.parse((await run("tables", "--db", path)).stdout);
    expect(tables.length).toBe(67);
    expect((await run("init", "--db", path)).code).toBe(1);
    const insert = ["insert", "--db", path, "--table", "metadata", "--values", '{"key":"test","value":"one"}'];
    expect(JSON.parse((await run(...insert)).stdout).dryRun).toBe(true);
    expect(JSON.parse((await run("rows", "--db", path, "--table", "metadata")).stdout)).toEqual([]);
    expect(JSON.parse((await run(...insert, "--apply")).stdout).changes).toBe(1);
    expect((await run(...insert, "--apply")).code).toBe(1); // constraint failure rolls back
    expect((await run("update", "--db", path, "--table", "metadata", "--values", '{"value":"two"}', "--apply")).code).toBe(1);
    expect((await run("update", "--db", path, "--table", "metadata", "--values", '{"value":"two"}', "--where", '{"key":"test"}', "--apply")).code).toBe(0);
    expect(JSON.parse((await run("rows", "--db", path, "--table", "metadata")).stdout)).toEqual([{ key: "test", value: "two" }]);
    expect((await run("delete", "--db", path, "--table", "_deltadb_cli_sandbox", "--where", '{"id":1}', "--apply")).code).toBe(1);
    expect(JSON.parse((await run("delete", "--db", path, "--table", "metadata", "--where", '{"key":"test"}', "--apply")).stdout).changes).toBe(1);
    expect(JSON.parse((await run("rows", "--db", path, "--table", "metadata")).stdout)).toEqual([]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
