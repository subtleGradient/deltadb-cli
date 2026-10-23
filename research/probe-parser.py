#!/usr/bin/env python3
"""Probe Delta 0.21.0's real parser, not the app/database, in a networkless sandbox.

Requires Linux, bubblewrap, gdb, nm and readelf. No account or application main
code is run. Rust ABI/layout is private: refuse any other binary build.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

app = Path(os.environ.get("DELTA_APP_BINARY", str(Path.home() / ".local/delta.app/bin/delta-app"))).resolve()
build = subprocess.check_output(["readelf", "-n", str(app)], text=True)
expected_build = "48fc3e0c984c442bb11f14d53abd30ac81c450da"
if f"Build ID: {expected_build}" not in build:
    raise SystemExit("Unsupported binary build: private ABI probe intentionally refused")
symbols = subprocess.check_output(["nm", "-C", str(app)], text=True)
main = int(re.search(r"^([0-9a-f]+) T main$", symbols, re.M)[1], 16)
parser = int(next(line.split()[0] for line in symbols.splitlines()
    if "<thread::external::records::RecordingEnvelope>::parse::<" in line), 16)
message = {"sessionUpdate": "user_message", "messageId": "synthetic-1",
           "content": [{"type": "text", "text": "Synthetic fixture only"}]}
def envelope(update, sequence=1, **extra):
    return {"schemaVersion": 1, "sequence": sequence, **extra, "update": update}
cases = [
    ("user-message", envelope(message), True),
    ("running-turn", envelope({"sessionUpdate": "state_update", "state": "running"}, turnSequence=1), True),
    ("scoped-agent-message", envelope({**message, "sessionUpdate": "agent_message"}, 2, turnSequence=1), True),
    ("title-update", envelope({"sessionUpdate": "session_info_update", "title": "Synthetic title"}), True),
    ("wrong-schema", {**envelope(message), "schemaVersion": 2}, False),
    ("zero-sequence", envelope(message, 0), False),
    ("unknown-envelope-field", {**envelope(message), "unexpected": True}, False),
    ("missing-message-id", envelope({"sessionUpdate": "user_message", "content": message["content"]}), False),
    ("unscoped-imported-agent", envelope({**message, "sessionUpdate": "agent_message"}), True),
]

with tempfile.TemporaryDirectory(prefix="delta-parser-", dir="/tmp/opencode") as folder:
    work = Path(folder)
    (work / "cases.json").write_text(json.dumps(cases))
    program = r'''
import gdb, json, struct
gdb.execute("set pagination off")
gdb.execute("set confirm off")
gdb.execute("set startup-with-shell off")
gdb.execute("break main")
gdb.execute("run --help")
gdb.execute("set $base = (unsigned long)&main - MAIN_OFFSET")
gdb.execute("set $capture = (char*)calloc(1,128)")
for offset, target in [(0,32),(8,56),(16,80),(24,81)]:
    gdb.execute("set *(void**)($capture+%d) = $capture+%d" % (offset,target))
for offset in [40,64]:
    gdb.execute("set *(unsigned long*)($capture+%d) = 1" % offset)
inferior = gdb.selected_inferior()
results = []
for name, record, expected in json.load(open("/tmp/research/cases.json")):
    data = json.dumps(record, separators=(",", ":")).encode()
    gdb.execute("set $input = (char*)malloc(%d)" % len(data))
    gdb.execute("set $out = (char*)calloc(1,4096)")
    inferior.write_memory(int(gdb.parse_and_eval("$input")), data)
    gdb.execute("call ((void(*)(void*,const char*,unsigned long,void*))($base+PARSER_OFFSET))($out,$input,%d,$capture)" % len(data))
    out = int(gdb.parse_and_eval("$out"))
    raw = bytes(inferior.read_memory(out, 40))
    accepted = struct.unpack_from("<q",raw)[0] != -1
    error = None
    if not accepted and struct.unpack_from("<I",raw,8)[0] in [0,2]:
        pointer,length = struct.unpack_from("<QQ",raw,24)
        if 0 < length < 4096:
            error = bytes(inferior.read_memory(pointer,length)).decode("utf-8", "replace")
    results.append(dict(case=name,accepted=accepted,expected=expected,error=error))
print("PROBE_RESULT="+json.dumps(results))
gdb.execute("quit")
'''.replace("MAIN_OFFSET", str(main)).replace("PARSER_OFFSET", str(parser))
    (work / "probe.py").write_text(program)
    cmd = ["bwrap", "--die-with-parent", "--unshare-net", "--ro-bind", "/", "/",
           "--tmpfs", "/home", "--tmpfs", "/run", "--tmpfs", "/tmp", "--proc", "/proc",
           "--ro-bind", str(app), "/tmp/delta-app",
           "--ro-bind", str(app.parent.parent / "lib"), "/tmp/lib",
           "--bind", folder, "/tmp/research", "--setenv", "HOME", "/tmp/research",
           "--setenv", "LD_LIBRARY_PATH", "/tmp/lib", "--chdir", "/tmp/research",
           "gdb", "-q", "-batch", "-ex", "set debuginfod enabled off",
           "-ex", "source /tmp/research/probe.py", "/tmp/delta-app"]
    result = subprocess.run(cmd, text=True, capture_output=True, timeout=60,
                            env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "DEBUGINFOD_URLS": ""})
    match = re.search(r"^PROBE_RESULT=(.*)$", result.stdout, re.M)
    if result.returncode or not match:
        raise SystemExit(result.stdout + result.stderr)
    results = json.loads(match[1])
    print(json.dumps({"buildId": expected_build, "scope": "parser-only; no storage or application main", "cases": results}, indent=2))
    if any(row["accepted"] != row["expected"] for row in results):
        raise SystemExit(1)
