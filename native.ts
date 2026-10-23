export const nativeUsage = `Native Delta operations (require installed Delta and an account-selected store):
  deltadb threads list [--database-dir DIR]
  deltadb threads get --thread ID [--database-dir DIR]
  deltadb threads create --source NAME --external-id ID [--parent ID --name NAME] [--apply]
  deltadb threads delete --thread ID [--apply] [--database-dir DIR]
  deltadb messages list --thread ID [--range FIRST-LAST] [--database-dir DIR]

Create previews locally unless --apply. Delete asks Delta for its deletion preview
unless --apply; applying may delete the thread's uniquely owned data and Cloud Runner.
Native thread updates and message create/update/delete are not yet supported.
Native operations use Delta's active account unless --database-dir is specified;
--db is only for SQLite operations, not native thread operations.
`;

export async function runNative(group: string, args: string[]): Promise<boolean> {
  if (group !== "threads" && group !== "messages") return false;
  const [action, ...rest] = args;
  if (group === "threads" && action === "update" || group === "messages" && ["create", "update", "delete"].includes(action)) {
    throw new Error("Unsupported native mutation: Delta 0.21.0 exposes no verified contract for this operation. No changes made.");
  }
  const key = `${group} ${action}`;
  const fields: Record<string, string[]> = {
    "threads list": [], "threads get": ["thread"],
    "threads create": ["source", "external-id", "parent", "name", "apply"],
    "threads delete": ["thread", "apply"], "messages list": ["thread", "range"],
  };
  if (!(key in fields)) throw new Error(`Unknown native operation: ${key}\n${nativeUsage}`);
  const allowed = new Set(["database-dir", ...fields[key]]);
  const options = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(rest[i]);
    if (!match || !allowed.has(match[1])) throw new Error(`Unknown option: ${rest[i]}`);
    const [, name, inline] = match;
    if (options.has(name)) throw new Error(`Duplicate --${name}`);
    if (name === "apply") {
      if (inline !== undefined) throw new Error("--apply takes no value");
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
  const command = ["delta", "--json"];
  if (options.has("database-dir")) command.push("--database-dir", required("database-dir"));
  command.push("thread");
  switch (key) {
    case "threads list": command.push("list"); break;
    case "threads get": command.push("show", required("thread")); break;
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
