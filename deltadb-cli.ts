import { SQL } from "bun";
import { open, unlink } from "node:fs/promises";
import { resolve } from "node:path";

export const databaseUsage = `Read any SQLite/Delta database (JSON output):
  deltadb tables --db PATH
  deltadb schema --db PATH [--table NAME]
  deltadb rows --db PATH --table NAME [--limit 100] [--offset 0]
  deltadb query --db PATH --sql 'SELECT ...' [--params '[...]']

Create a standalone SQLite sandbox with Delta's captured schema:
  deltadb init --db NEW_PATH
  deltadb insert --db PATH --table NAME --values '{"column":"value"}' [--apply]
  deltadb update --db PATH --table NAME --values '{...}' --where '{"id":1}' [--apply]
  deltadb delete --db PATH --table NAME --where '{"id":1}' [--apply]

Writes are dry-run by default and only allowed in tool-created sandboxes.
Sandboxes are NOT initialized Delta replicas and must not be opened as such.
Use Delta's native CLI for application-level writes to real databases.
`;

const marker = "_deltadb_cli_sandbox";
const commands = new Set(["tables", "schema", "rows", "query", "init", "insert", "update", "delete"]);
function identifier(name: string): string {
  if (name.includes("\0")) throw new Error("Invalid identifier");
  return `"${name.replaceAll('"', '""')}"`;
}
function object(value: string | undefined, label: string): Record<string, any> {
  const parsed = JSON.parse(value ?? "null");
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" || !Object.keys(parsed).length) {
    throw new Error(`${label} must be a non-empty JSON object`);
  }
  for (const item of Object.values(parsed)) {
    if (item !== null && !["string", "number", "boolean"].includes(typeof item)) {
      throw new Error(`${label} values must be SQLite scalars (string, number, boolean, null)`);
    }
  }
  return parsed;
}
function output(value: unknown): void {
  console.log(JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2));
}

function singleStatement(sql: string): void {
  // Ignore quoted literals/identifiers and comments when finding statement separators.
  const tokens = sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g, " ");
  if (tokens.replace(/;\s*$/, "").includes(";")) throw new Error("query accepts one SQL statement only");
}

export async function runDatabaseCommand(command: string, args: string[]): Promise<boolean> {
  if (!commands.has(command)) return false;
  const allowed = new Set(["db", ...({
    tables: [], schema: ["table"], rows: ["table", "limit", "offset"],
    query: ["sql", "params"], init: [], insert: ["table", "values", "apply"],
    update: ["table", "values", "where", "apply"], delete: ["table", "where", "apply"],
  }[command] ?? [])]);
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(args[i]);
    if (!match || !allowed.has(match[1])) throw new Error(`Unknown option: ${args[i]}`);
    const [, key, inline] = match;
    if (options.has(key)) throw new Error(`Duplicate option --${key}`);
    if (key === "apply") {
      if (inline !== undefined) throw new Error("--apply takes no value");
      options.set(key, "true");
    } else {
      const value = inline ?? args[++i];
      if (!value || value.startsWith("--")) throw new Error(`--${key} needs a value`);
      options.set(key, value);
    }
  }
  const required = (key: string) => {
    const value = options.get(key);
    if (!value) throw new Error(`Missing --${key}`);
    return value;
  };
  const path = resolve(required("db"));
  if (command === "init") {
    // Exclusive reservation: never truncate or replace an existing database or symlink.
    const file = await open(path, "wx", 0o600);
    await file.close();
    let db: SQL | undefined;
    try {
      db = new SQL({ adapter: "sqlite", filename: path });
      const snapshot = await Bun.file(new URL("./2026-10-23-1408-delta-db-sqlite-schema.md", import.meta.url)).text();
      const ddl = snapshot.match(/```sql\n([\s\S]*?)```/)?.[1]
        .replace(/CREATE TABLE sqlite_sequence\(name,seq\);/, "");
      if (!ddl) throw new Error("Captured schema DDL is missing");
      await db.begin(async tx => {
        // This fixed snapshot has no triggers or semicolons inside literals.
        const statements = ddl.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean);
        // sqlite_schema was captured sorted by type: indexes precede their tables.
        statements.sort((a, b) => Number(/CREATE (?:UNIQUE )?INDEX/i.test(a)) - Number(/CREATE (?:UNIQUE )?INDEX/i.test(b)));
        for (const statement of statements) {
          await tx.unsafe(statement);
        }
        await tx.unsafe(`CREATE TABLE ${identifier(marker)} (id INTEGER PRIMARY KEY CHECK(id=1), format TEXT NOT NULL)`);
        await tx.unsafe(`INSERT INTO ${identifier(marker)} VALUES (1, 'schema-sandbox-v1')`);
      });
      output({ database: path, kind: "schema-sandbox", appReady: false });
    } catch (error) {
      await db?.close();
      db = undefined;
      await unlink(path);
      throw error;
    } finally { await db?.close(); }
    return true;
  }
  if (!(await Bun.file(path).exists())) throw new Error(`Database does not exist: ${path}`);
  const write = ["insert", "update", "delete"].includes(command);
  // Even write previews use a read-only connection.
  const apply = write && options.has("apply");
  const db = new SQL({ adapter: "sqlite", filename: path, readonly: !apply, readwrite: apply, create: false });
  try {
    if (!apply) await db.unsafe("PRAGMA query_only = ON");
    if (command === "tables") {
      output(await db.unsafe("SELECT name, type FROM sqlite_schema WHERE type IN ('table','view') ORDER BY name"));
    } else if (command === "schema") {
      output(await db.unsafe("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE sql IS NOT NULL" +
        (options.has("table") ? " AND tbl_name = ?" : "") + " ORDER BY type, name",
        options.has("table") ? [required("table")] : []));
    } else if (command === "query") {
      const sql = required("sql");
      singleStatement(sql);
      if (!/^\s*(SELECT|WITH|EXPLAIN)\b/i.test(sql)) throw new Error("query accepts SELECT, WITH, or EXPLAIN only");
      const params = JSON.parse(options.get("params") ?? "[]");
      if (!Array.isArray(params) || params.some(v => v !== null && !["string", "number", "boolean"].includes(typeof v))) {
        throw new Error("--params must be a JSON array of SQLite scalars");
      }
      output(await db.unsafe(sql, params));
    } else {
      const table = required("table");
      const found = await db.unsafe("SELECT type FROM sqlite_schema WHERE name = ? AND type IN ('table','view')", [table]);
      if (!found.length) throw new Error(`Unknown table: ${table}`);
      const quoted = identifier(table);
      if (command === "rows") {
        const limit = Number(options.get("limit") ?? 100);
        const offset = Number(options.get("offset") ?? 0);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000 || !Number.isSafeInteger(offset) || offset < 0) {
          throw new Error("--limit must be 1..10000; --offset must be a non-negative integer");
        }
        output(await db.unsafe(`SELECT * FROM ${quoted} LIMIT ? OFFSET ?`, [limit, offset]));
      } else {
        const sandbox = await db.unsafe("SELECT name FROM sqlite_schema WHERE type='table' AND name=?", [marker]);
        if (!sandbox.length || (await db.unsafe(`SELECT format FROM ${identifier(marker)} WHERE id=1`))[0]?.format !== "schema-sandbox-v1") {
          throw new Error("Direct writes are restricted to deltadb init sandboxes; use Delta CLI for real replicas");
        }
        if (table === marker || table.startsWith("sqlite_") || found[0].type !== "table") throw new Error("Protected write target");
        const values = command === "delete" ? {} : object(required("values"), "--values");
        const where = command === "insert" ? {} : object(required("where"), "--where");
        const columns = new Set((await db.unsafe(`PRAGMA table_info(${quoted})`)).map(r => r.name));
        for (const key of [...Object.keys(values), ...Object.keys(where)]) {
          if (!columns.has(key)) throw new Error(`Unknown column: ${key}`);
        }
        const bindings = [...Object.values(values), ...Object.values(where)];
        const predicate = Object.keys(where).map(k => `${identifier(k)} IS ?`).join(" AND ");
        const sql = command === "insert"
          ? `INSERT INTO ${quoted} (${Object.keys(values).map(identifier).join(", ")}) VALUES (${Object.keys(values).map(() => "?").join(", ")})`
          : command === "update"
            ? `UPDATE ${quoted} SET ${Object.keys(values).map(k => `${identifier(k)} = ?`).join(", ")} WHERE ${predicate}`
            : `DELETE FROM ${quoted} WHERE ${predicate}`;
        if (!apply) output({ dryRun: true, sql, params: bindings });
        else {
          await db.unsafe("PRAGMA foreign_keys = ON");
          const changes = await db.begin(async tx => {
            await tx.unsafe(sql, bindings);
            return (await tx.unsafe("SELECT changes() AS changes"))[0].changes;
          });
          output({ applied: true, changes });
        }
      }
    }
  } finally { await db.close(); }
  return true;
}
