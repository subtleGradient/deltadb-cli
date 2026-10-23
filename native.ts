import { recordNative } from "./recording";

export const nativeUsage = `Native Delta operations (require installed Delta and an account-selected store):
  deltadb threads list [--database-dir DIR]
  deltadb threads get --thread ID [--database-dir DIR]
  deltadb threads watch --thread ID [--database-dir DIR]
  deltadb threads sync --thread ID [--database-dir DIR] [--apply]
  deltadb threads create --source NAME --external-id ID [--parent ID --name NAME] [--apply]
  deltadb threads delete --thread ID [--apply] [--database-dir DIR]
  deltadb threads status --thread ID --source NAME --external-id ID [--database-dir DIR]
  deltadb threads update --thread ID --source NAME --external-id ID --sequence N --title TEXT [--apply]
  deltadb messages list --thread ID [--range FIRST-LAST] [--database-dir DIR]
  deltadb messages create --thread ID --source NAME --external-id ID --sequence N --message-id ID --text TEXT [--role user|assistant] [--turn-sequence N] [--apply]
  # Use --text-stdin instead of --text to send UTF-8 content through SSH/stdin.

Create previews locally unless --apply. Delete asks Delta for its deletion preview
unless --apply; applying may delete the thread's uniquely owned data and Cloud Runner.
Record writes preview without calling Delta; --apply checks contract, producer,
frontier and receipts. Optional --acknowledge local|server (default server).
Thread updates support titles only. Message update/delete are not yet supported.
Native operations use Delta's active account unless --database-dir is specified;
--db is only for SQLite operations, not native thread operations.
Singular 'thread' is an alias for 'threads'. Watch streams native JSONL read-only,
without joining/keeping a producer turn alive. Sync previews locally unless
--apply; it uses Delta's existing sync backend, NOT a custom transport endpoint.
`;

export async function runNative(group: string, args: string[]): Promise<boolean> {
  if (group === "thread") group = "threads";
  if (group !== "threads" && group !== "messages") return false;
  const [action, ...rest] = args;
  if (group === "messages" && ["update", "delete"].includes(action)) {
    throw new Error("Unsupported native mutation: Delta 0.21.0 exposes no verified contract for this operation. No changes made.");
  }
  const key = `${group} ${action}`;
  const fields: Record<string, string[]> = {
    "threads list": [], "threads get": ["thread"],
    "threads watch": ["thread"], "threads sync": ["thread", "apply"],
    "threads create": ["source", "external-id", "parent", "name", "apply"],
    "threads delete": ["thread", "apply"], "messages list": ["thread", "range"],
    "threads status": ["thread", "source", "external-id"],
    "threads update": ["thread", "source", "external-id", "sequence", "title", "apply", "acknowledge"],
    "messages create": ["thread", "source", "external-id", "sequence", "message-id", "text", "text-stdin", "role", "turn-sequence", "apply", "acknowledge"],
  };
  if (!(key in fields)) throw new Error(`Unknown native operation: ${key}\n${nativeUsage}`);
  const allowed = new Set(["database-dir", ...fields[key]]);
  const options = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(rest[i]);
    if (!match || !allowed.has(match[1])) throw new Error(`Unknown option: ${rest[i]}`);
    const [, name, inline] = match;
    if (options.has(name)) throw new Error(`Duplicate --${name}`);
    if (name === "apply" || name === "text-stdin") {
      if (inline !== undefined) throw new Error(`--${name} takes no value`);
      options.set(name, "true");
    } else {
      const value = inline ?? rest[++i];
      if (!value || value.startsWith("--")) throw new Error(`--${name} needs a value`);
      options.set(name, value);
    }
  }
  const required = (name: string) => {
    const value = options.get(name);
    if (!value) throw new Error(`Missing --${name}`);
    return value;
  };
  if (key === "messages create" && options.has("text-stdin")) {
    if (options.has("text")) throw new Error("Use either --text or --text-stdin, not both");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const chunks: string[] = [];
    let bytes = 0;
    for await (const chunk of Bun.stdin.stream()) {
      bytes += chunk.byteLength;
      if (bytes > 16 * 1024 * 1024) throw new Error("Stdin text exceeds 16 MiB");
      chunks.push(decoder.decode(chunk, { stream: true }));
    }
    chunks.push(decoder.decode());
    options.set("text", chunks.join(""));
  }
  if (key === "messages create" || key === "threads update") {
    await recordNative(key === "messages create" ? "message" : "title", options);
    return true;
  }
  const command = ["delta", "--json"];
  if (options.has("database-dir")) command.push("--database-dir", required("database-dir"));
  command.push("thread");
  switch (key) {
    case "threads list": command.push("list"); break;
    case "threads get": command.push("show", required("thread")); break;
    case "threads watch": command.push("watch", required("thread")); break;
    case "threads sync": {
      command.push("sync", required("thread"));
      if (!options.has("apply")) {
        console.log(JSON.stringify({ dryRun: true, command,
          note: "No Delta command run. Apply uses Delta's existing backend, not a custom transport. May synchronize thread data remotely." }, null, 2));
        return true;
      }
      break;
    }
    case "threads status": command.push("status", "--source", required("source"), "--external-id", required("external-id"), required("thread")); break;
    case "threads create": {
      command.push("create", "--source", required("source"), "--external-id", required("external-id"));
      if (options.has("name") && !options.has("parent")) throw new Error("Delta documents --name for child threads only; supply --parent");
      for (const field of ["parent", "name"]) if (options.has(field)) command.push(`--${field}`, required(field));
      if (!options.has("apply")) {
        console.log(JSON.stringify({ dryRun: true, command, target: options.get("database-dir") ?? "active Delta account" }, null, 2));
        return true;
      }
      break;
    }
    case "threads delete":
      command.push("delete", required("thread"));
      if (options.has("apply")) command.push("--force");
      break;
    case "messages list": {
      command.push("show", required("thread"), "--format", "messages");
      if (options.has("range")) {
        const range = /^(\d+)-(\d+)$/.exec(required("range"));
        if (!range || Number(range[1]) < 1 || Number(range[2]) < Number(range[1]) ||
          !Number.isSafeInteger(Number(range[2])) || Number(range[2]) - Number(range[1]) >= 20) {
          throw new Error("--range must be FIRST-LAST, positive, ascending, at most 20 messages");
        }
        command.push("--messages", required("range"));
      }
      break;
    }
  }
  const child = Bun.spawn(command, { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  const code = await child.exited;
  if (code !== 0) throw new Error(`Delta exited with status ${code}`);
  return true;
}
