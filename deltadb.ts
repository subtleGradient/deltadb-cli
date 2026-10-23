import { createHash } from "node:crypto";
import { SQL } from "bun";
import { runDatabaseCommand, databaseUsage } from "./deltadb-cli";
import { runNative, nativeUsage } from "./native";

type Options = Map<string, string | true>;

const usage = `DeltaDB CLI

${databaseUsage}

${nativeUsage}

Read-only schema inspection:
  bun deltadb.ts inspect --db PATH [--ddl]

Guarded thread append (dry-run unless --apply):
  bun deltadb.ts append --thread THREAD --source PRODUCER \\
    --external-id ID --records FILE [--acknowledge local|server] \\
    [--producer-name NAME] [--database-dir DIR] [--apply]

The append mode validates JSONL syntax only. Supply records from a producer
that knows Delta's schema-1 contract; this tool does not invent record shapes.
`;

function parseOptions(args: string[], booleanFlags: Set<string>): Options {
  const options: Options = new Map();
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const [key, inlineValue] = token.slice(2).split("=", 2);
    if (options.has(key)) throw new Error(`Option --${key} was supplied more than once`);
    if (booleanFlags.has(key)) {
      if (inlineValue !== undefined) throw new Error(`Option --${key} takes no value`);
      options.set(key, true);
      continue;
    }
    const value = inlineValue ?? args[++i];
    if (!value || value.startsWith("--")) throw new Error(`Option --${key} needs a value`);
    options.set(key, value);
  }
  return options;
}

function required(options: Options, name: string): string {
  const value = options.get(name);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required option --${name}`);
  }
  return value;
}

async function inspectDatabase(options: Options): Promise<void> {
  const filename = required(options, "db");
  if (!(await Bun.file(filename).exists())) throw new Error(`Database does not exist: ${filename}`);

  const db = new SQL({
    adapter: "sqlite",
    filename,
    readonly: true,
    create: false,
    readwrite: false,
  });

  try {
    const ddlRows = await db`
      SELECT type, name, tbl_name, sql
      FROM sqlite_schema
      WHERE sql IS NOT NULL
      ORDER BY type, name
    `;
    const pragmas = {
      schema_version: (await db`PRAGMA schema_version`)[0]?.schema_version,
      user_version: (await db`PRAGMA user_version`)[0]?.user_version,
      application_id: (await db`PRAGMA application_id`)[0]?.application_id,
      journal_mode: (await db`PRAGMA journal_mode`)[0]?.journal_mode,
    };
    const tableNames = new Set(ddlRows.filter(row => row.type === "table").map(row => row.name));
    const metadata = tableNames.has("metadata") ? await db`
      SELECT key, value FROM metadata
      WHERE key IN ('schema_version', 'commit_generation')
      ORDER BY key
    ` : [];
    const appMeta = tableNames.has("app_meta") ? await db`
      SELECT key, value FROM app_meta
      WHERE key LIKE '%schema_version%'
      ORDER BY key
    ` : [];
    const canonicalRows = ddlRows.map((row) => [row.type, row.name, row.tbl_name, row.sql]);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(canonicalRows), "utf8")
      .digest("hex");
    const counts = Object.groupBy(ddlRows, (row) => row.type);

    console.log(`Database: ${filename}`);
    console.log(`Explicit DDL objects: ${ddlRows.length}`);
    console.log(`Tables: ${counts.table?.length ?? 0}`);
    console.log(`Explicit indexes: ${counts.index?.length ?? 0}`);
    console.log(`Schema fingerprint: sha256:${fingerprint}`);
    console.log("SQLite markers:", JSON.stringify(pragmas));
    console.log("Delta metadata:", JSON.stringify(metadata));
    console.log("Delta app metadata:", JSON.stringify(appMeta));

    if (options.has("ddl")) {
      for (const row of ddlRows) {
        const owner = row.type === "index" ? ` (on ${row.tbl_name})` : "";
        console.log(`\n-- ${row.type}: ${row.name}${owner}`);
        console.log(`${row.sql.trim().replace(/;+$/, "")};`);
      }
    }
  } finally {
    await db.close();
  }
}

async function appendRecords(options: Options): Promise<void> {
  const thread = required(options, "thread");
  const source = required(options, "source");
  const externalId = required(options, "external-id");
  const recordsPath = required(options, "records");
  const acknowledge = options.get("acknowledge") ?? "server";
  if (acknowledge !== "local" && acknowledge !== "server") {
    throw new Error("--acknowledge must be either local or server");
  }

  const payload = await Bun.file(recordsPath).arrayBuffer().then((buffer) => Buffer.from(buffer));
  const text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0 || lines.some((line) => line.trim() === "")) {
    throw new Error("Record file must contain non-empty JSONL records (blank lines are rejected)");
  }
  for (const [index, line] of lines.entries()) {
    try {
      JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON on record line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const digest = createHash("sha256").update(payload).digest("hex");
  const command = [
    "delta",
    "thread",
    "append",
    "--source",
    source,
    "--external-id",
    externalId,
    "--acknowledge",
    acknowledge,
  ];
  const databaseDir = options.get("database-dir");
  if (typeof databaseDir === "string") command.splice(1, 0, "--database-dir", databaseDir);
  const producerName = options.get("producer-name");
  if (typeof producerName === "string") command.push("--producer-name", producerName);
  command.push(thread);

  console.log(`Thread: ${thread}`);
  console.log(`Producer: ${source} (${externalId})`);
  console.log(`Records: ${lines.length}; bytes: ${payload.byteLength}; sha256:${digest}`);
  console.log(`Acknowledgment: ${acknowledge}`);

  if (!options.has("apply")) {
    console.log("Dry run only; no Delta command was run. Add --apply to forward this file to delta thread append.");
    return;
  }

  console.error("Applying append through Delta CLI; this changes the selected thread and may synchronize remotely.");
  const child = Bun.spawn(command, { stdin: "pipe", stdout: "inherit", stderr: "inherit" });
  child.stdin.write(payload);
  child.stdin.end();
  const status = await child.exited;
  if (status !== 0) throw new Error(`delta thread append exited with status ${status}`);
}

async function main(): Promise<void> {
  const [mode, ...args] = process.argv.slice(2);
  if (!mode || mode === "--help" || mode === "-h" || mode === "help") {
    console.log(usage);
    return;
  }

  if (mode === "inspect") {
    const options = parseOptions(args, new Set(["ddl"]));
    for (const key of options.keys()) {
      if (key !== "db" && key !== "ddl") throw new Error(`Unknown inspect option --${key}`);
    }
    await inspectDatabase(options);
    return;
  }

  if (await runDatabaseCommand(mode, args)) return;
  if (await runNative(mode, args)) return;

  if (mode === "append") {
    const options = parseOptions(args, new Set(["apply"]));
    const allowed = new Set(["thread", "source", "external-id", "records", "acknowledge", "producer-name", "database-dir", "apply"]);
    for (const key of options.keys()) {
      if (!allowed.has(key)) throw new Error(`Unknown append option --${key}`);
    }
    await appendRecords(options);
    return;
  }

  throw new Error(`Unknown mode: ${mode}\n\n${usage}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
