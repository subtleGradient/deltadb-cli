// Shapes evidenced by zed-industries/delta-claude at
// 5efb02649ac13b6404972dc38949554625447a4f, hooks/recording/{content,delivery,title}.ts.
// Independently accepted by the installed 0.21.0 RecordingEnvelope::parse.
type Options = Map<string, string>;
export function buildRecord(kind: "message" | "title", options: Options) {
  const required = (name: string) => {
    const value = options.get(name);
    if (!value) throw new Error(`Missing --${name}`);
    return value;
  };
  const positive = (name: string) => {
    const value = required(name);
    const n = Number(value);
    if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(n)) throw new Error(`--${name} must be a positive safe integer`);
    return n;
  };
  const sequence = positive("sequence");
  const turnSequence = options.has("turn-sequence") ? positive("turn-sequence") : undefined;
  if (turnSequence !== undefined && turnSequence >= sequence) throw new Error("--turn-sequence must precede --sequence");
  let update: Record<string, unknown>;
  if (kind === "title") {
    const title = required("title");
    if (title.length > 200 || /[\r\n]/.test(title) || !title.trim()) throw new Error("--title must be a nonblank single line, at most 200 characters");
    update = { sessionUpdate: "session_info_update", title };
  } else {
    const role = options.get("role") ?? "user";
    if (!["user", "assistant"].includes(role)) throw new Error("--role must be user or assistant");
    // More conservative than Delta's imported-history parser: do not invent a live agent turn.
    if (role === "assistant" && turnSequence === undefined) throw new Error("Assistant output requires --turn-sequence from an existing running producer turn");
    update = { sessionUpdate: role === "user" ? "user_message" : "agent_message",
      messageId: required("message-id"), content: [{ type: "text", text: required("text") }] };
  }
  const record = { schemaVersion: 1, sequence, ...(turnSequence === undefined ? {} : { turnSequence }), update };
  if (Buffer.byteLength(JSON.stringify(record), "utf8") > 16 * 1024 * 1024) throw new Error("Record exceeds Delta's 16 MiB limit");
  return record;
}

async function capture(command: string[], input?: string): Promise<string> {
  const child = Bun.spawn(command, { stdin: input === undefined ? "ignore" : new TextEncoder().encode(input), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`Delta exited ${code}: ${stderr.trim() || stdout.trim()}. An append may have been stored; inspect status before retrying.`);
  return stdout;
}

export async function recordNative(kind: "message" | "title", options: Options): Promise<void> {
  const required = (name: string) => {
    const value = options.get(name);
    if (!value) throw new Error(`Missing --${name}`);
    return value;
  };
  const thread = required("thread");
  const source = required("source");
  const externalId = required("external-id");
  const acknowledge = options.get("acknowledge") ?? "server";
  if (!["local", "server"].includes(acknowledge)) throw new Error("--acknowledge must be local or server");
  const record = buildRecord(kind, options);
  const prefix = ["delta", "--json"];
  if (options.has("database-dir")) prefix.push("--database-dir", required("database-dir"));
  const producer = ["--source", source, "--external-id", externalId];
  const command = [...prefix, "thread", "append", ...producer, "--acknowledge", acknowledge, thread];
  if (!options.has("apply")) {
    console.log(JSON.stringify({ dryRun: true, command, record,
      note: "No Delta command run. Parser-verified shape; storage/receipt validation occurs only on --apply." }, null, 2));
    return;
  }
  const contract = JSON.parse(await capture([...prefix, "thread", "contract"]));
  if (contract.operation !== "contract" || !Number.isSafeInteger(contract.min) || !Number.isSafeInteger(contract.max) ||
      contract.min > contract.max || contract.min < 0 || contract.min > 7 || contract.max < 6) {
    throw new Error("No overlap with verified recording-output contracts 6..7; append refused");
  }
  const status = JSON.parse(await capture([...prefix, "thread", "status", ...producer, thread]));
  if (status.operation !== "status" || status.thread_id !== thread || status.producer?.source !== source ||
      status.producer?.external_id !== externalId || status.producer?.next_sequence !== record.sequence) {
    throw new Error("Thread/producer/frontier mismatch: use a canonical thread ID and its exact next_sequence; append refused");
  }
  if (status.producer.turn?.status === "running" && record.turnSequence === undefined) {
    throw new Error("Producer has a running turn; unscoped mutation refused");
  }
  if (record.turnSequence !== undefined && (status.producer.turn?.sequence !== record.turnSequence || status.producer.turn?.status !== "running")) {
    throw new Error("Selected producer turn is not running; append refused");
  }
  // Exactly one record. No automatic retries, allocation, turn takeover, or schema-table writes.
  const stdout = await capture(command, JSON.stringify(record) + "\n");
  const lines = stdout.trim().split("\n");
  let receipt: any;
  try { if (lines.length === 1) receipt = JSON.parse(lines[0]); } catch {}
  if (!receipt || receipt.operation !== "appended" || receipt.thread_id !== thread || receipt.sequence !== record.sequence ||
      !Number.isSafeInteger(receipt.next_sequence) || receipt.next_sequence <= record.sequence ||
      receipt.turn_sequence !== (record.turnSequence ?? null) || typeof receipt.version !== "string" || !receipt.version ||
      !["recorded", "duplicate", "fenced"].includes(receipt.disposition) ||
      typeof receipt.duplicate !== "boolean" || receipt.duplicate !== (receipt.disposition === "duplicate")) {
    throw new Error("Invalid append receipt; outcome unknown. Do not advance/reuse the sequence without inspecting status.");
  }
  if (receipt.disposition !== "recorded") {
    throw new Error(`Append returned ${receipt.disposition}, not a confirmed new mutation; inspect status before retrying`);
  }
  console.log(JSON.stringify(receipt, null, 2));
}
