/** Experimental transcript relay, NOT native DeltaDB replication. */
import { createHash } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildRecord } from "../recording";

export const marker = "[deltadb-watch-relay:";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export type Config = {
  fromPeer: string; fromThread: string; toThread: string;
  databaseDir?: string; state?: string; apply: boolean; maxItems: number;
};
export function identity(config: Config) {
  return { source: "deltadb-watch-relay", externalId: hash(JSON.stringify([
    config.fromPeer, config.fromThread, config.toThread,
  ])) };
}

export class Translator {
  private ready = false;
  private live = false;
  constructor(private config: Config) {}
  finish() {
    if (!this.ready || !this.live) throw new Error("Watch ended before matching ready/live handshake");
  }
  accept(frame: any): { id: string; digest: string; messageId: string; text: string } | null {
    if (!frame || typeof frame !== "object" || Array.isArray(frame)) throw new Error("Expected watch JSON object");
    if (frame.type === "ready") {
      if (this.ready || frame.thread_id !== this.config.fromThread) throw new Error("Watch source thread mismatch or repeated ready");
      this.ready = true;
      return null;
    }
    if (!this.ready) throw new Error("Watch must begin with matching ready");
    if (frame.type === "live") { this.live = true; return null; }
    if (frame.type !== "item") return null;
    const item = frame.item;
    if (!this.live || item?.kind !== "user_message" || item.open !== false) return null;
    if (typeof item.id !== "string" || !item.id || typeof item.content?.text !== "string") throw new Error("Malformed completed user message");
    if (!item.content.text.trim() || item.content.text.startsWith(marker)) return null;
    const key = hash(JSON.stringify([this.config.fromPeer, this.config.fromThread, item.id]));
    return { id: item.id, digest: hash(item.content.text), messageId: `watch-relay-${key}`,
      text: `${marker}${key}]\n${item.content.text}` };
  }
}

/** Synthetic tests inject submit. Real writes still use the existing guarded CLI. */
export async function relay(config: Config, lines: AsyncIterable<string>,
  submit: (message: { messageId: string; text: string }, producer: ReturnType<typeof identity>) => Promise<unknown>,
  emit: (value: unknown) => void = value => console.log(JSON.stringify(value))) {
  if (config.apply && config.fromThread === config.toThread) {
    throw new Error("Same-thread append replay refused: watch IDs are not native replication IDs. Use two distinct disposable threads for this experiment.");
  }
  if (config.apply && !config.state) throw new Error("--apply requires a new/private --state directory");
  const producer = identity(config);
  const translator = new Translator(config);
  const seen = new Map<string, string>();
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  let journal: Awaited<ReturnType<typeof open>> | undefined;
  let state: string | undefined;
  let processed = 0;
  try {
    if (config.apply) {
      state = resolve(config.state!);
      await mkdir(state, { recursive: true, mode: 0o700 });
      // Do not steal locks after a crash; operator must first reconcile outcomes.
      lock = await open(join(state, "lock"), "wx", 0o600);
      const expected = JSON.stringify({ version: 1, fromPeer: config.fromPeer,
        fromThread: config.fromThread, toThread: config.toThread,
        databaseDir: config.databaseDir ?? null, producer });
      let metadata: string;
      try { metadata = await readFile(join(state, "identity.json"), "utf8"); }
      catch (error: any) {
        if (error.code !== "ENOENT") throw error;
        const file = await open(join(state, "identity.json"), "wx", 0o600);
        try { await file.writeFile(expected); await file.sync(); } finally { await file.close(); }
        metadata = expected;
      }
      if (metadata !== expected) throw new Error("State directory belongs to a different route/target; refused");
      let prior = "";
      try { prior = await readFile(join(state, "journal.jsonl"), "utf8"); }
      catch (error: any) { if (error.code !== "ENOENT") throw error; }
      const pending = new Set<string>();
      for (const line of prior.split("\n").filter(Boolean)) {
        const entry = JSON.parse(line);
        if (entry.type === "pending" && typeof entry.id === "string" && typeof entry.digest === "string") {
          if (seen.has(entry.id)) throw new Error("Invalid journal: duplicate intent");
          seen.set(entry.id, entry.digest); pending.add(entry.id);
        } else if (entry.type === "recorded" && pending.has(entry.id)) pending.delete(entry.id);
        else throw new Error("Invalid journal; manual reconciliation required");
      }
      if (pending.size) throw new Error("Pending append outcome in journal; reconcile target status/read-back before any restart. No automatic retry.");
      journal = await open(join(state, "journal.jsonl"), "a", 0o600);
      const directory = await open(state, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    }
    for await (const line of lines) {
      if (!line.trim()) continue;
      const message = translator.accept(JSON.parse(line));
      if (!message) continue;
      const previous = seen.get(message.id);
      if (previous !== undefined) {
        if (previous !== message.digest) throw new Error("Source message changed after observation; editing is unsupported");
        emit({ operation: "skipped", reason: "already_seen", sourceItem: message.id });
        continue;
      }
      if (++processed > config.maxItems) throw new Error("Message budget exceeded; narrow the stream or raise --max-items explicitly");
      if (!config.apply) {
        seen.set(message.id, message.digest);
        emit({ dryRun: true, operation: "transcript_relay", nativeReplication: false,
          fromPeer: config.fromPeer, fromThread: config.fromThread, toThread: config.toThread,
          producer, sourceItem: message.id, messageId: message.messageId, text: message.text,
          note: "Sequence must come from fresh target status on apply; source authorship/history IDs are not preserved." });
        continue;
      }
      await journal!.writeFile(JSON.stringify({ type: "pending", id: message.id, digest: message.digest }) + "\n");
      await journal!.sync();
      // Once intent is durable, ANY failure leaves pending state. Never blind-retry.
      const receipt = await submit(message, producer);
      await journal!.writeFile(JSON.stringify({ type: "recorded", id: message.id, receipt }) + "\n");
      await journal!.sync();
      seen.set(message.id, message.digest);
      emit({ operation: "relayed", sourceItem: message.id, receipt, nativeReplication: false });
    }
    translator.finish();
    emit({ operation: "stream_ended", observedNewMessages: processed,
      note: "Only completed user-text items supported. Ignored events are not replicated. EOF does not prove source watch succeeded." });
  } finally {
    await journal?.close();
    if (lock) { await lock.close(); await unlink(join(state!, "lock")); }
  }
}

export async function* jsonLines(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      if (Buffer.byteLength(buffer.slice(0, newline)) > 1024 * 1024) throw new Error("Watch frame exceeds 1 MiB");
      yield buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
    }
    if (Buffer.byteLength(buffer) > 1024 * 1024) throw new Error("Watch frame exceeds 1 MiB");
  }
  buffer += decoder.decode();
  if (buffer.trim()) throw new Error("Truncated watch frame: final newline required");
}

async function capture(command: string[]) {
  const child = Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`Child failed (${code}): ${err.trim() || out.trim()}. Inspect pending journal; do not retry blindly.`);
  return JSON.parse(out);
}

async function main(args: string[]) {
  if (args.includes("--help")) {
    console.log(`Experimental transcript relay, NOT native DeltaDB sync.
Pipe native watch JSONL to: bun experiments/watch-relay.ts
  --from-peer NAME --from-thread ID --to-thread ID
  [--database-dir TARGET_DIR] [--max-items N (default 20)]
  [--apply --state PRIVATE_DIRECTORY]
Preview is local/no writes. Apply requires distinct disposable thread IDs, target
Delta/account and one writer. Uses local ack (NOT no-sync mode). Only finalized
user text; no assistant/tool/file/title/delete/identity/history replication.
State contains pending intents; ambiguous failures require manual reconciliation.`);
    return;
  }
  const values = new Map<string, string>();
  const allowed = new Set(["from-peer", "from-thread", "to-thread", "database-dir", "max-items", "state", "apply"]);
  for (let i = 0; i < args.length; i++) {
    const name = args[i].startsWith("--") ? args[i].slice(2) : "";
    if (!allowed.has(name) || values.has(name)) throw new Error(`Invalid/duplicate option: ${args[i]}`);
    if (name === "apply") { values.set(name, "true"); continue; }
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing --${name} value`);
    values.set(name, value);
  }
  const required = (name: string) => { const value = values.get(name); if (!value) throw new Error(`Missing --${name}`); return value; };
  const max = values.get("max-items") ?? "20";
  if (!/^[1-9][0-9]*$/.test(max) || !Number.isSafeInteger(Number(max))) throw new Error("Invalid --max-items");
  const config: Config = { fromPeer: required("from-peer"), fromThread: required("from-thread"),
    toThread: required("to-thread"), databaseDir: values.get("database-dir"), state: values.get("state"),
    apply: values.has("apply"), maxItems: Number(max) };
  await relay(config, jsonLines(Bun.stdin.stream()), async (message, producer) => {
    const common = config.databaseDir ? ["--database-dir", config.databaseDir] : [];
    const cli = [process.execPath, resolve(import.meta.dir, "../deltadb.ts")];
    const status = await capture([...cli, "threads", "status", ...common, "--thread", config.toThread,
      "--source", producer.source, "--external-id", producer.externalId]);
    const options = new Map<string, string>([["sequence", String(status.producer?.next_sequence)],
      ["message-id", message.messageId], ["text", message.text]]);
    buildRecord("message", options); // Do not submit an invalid source payload.
    return capture([...cli, "messages", "create", ...common, "--thread", config.toThread,
      "--source", producer.source, "--external-id", producer.externalId, "--sequence", options.get("sequence")!,
      "--message-id", message.messageId, "--text", message.text, "--acknowledge", "local", "--apply"]);
  });
}

if (import.meta.main) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
