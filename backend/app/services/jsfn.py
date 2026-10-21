import json
import re
import shutil
import subprocess
import tempfile

TIMEOUT = 6

RUNNER = r'''
const vm = require("vm");
let input = "";
process.stdin.on("data", (d) => (input += d)).on("end", async () => {
  const kill = setTimeout(() => { process.stderr.write("the function ran longer than 5 seconds"); process.exit(3); }, 5000);
  try {
    const req = JSON.parse(input);
    const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
    const ctx = vm.createContext({ console: quiet, __args: JSON.stringify(req.args) }, { codeGeneration: { strings: false, wasm: false } });
    const src = '"use strict";\n' + req.js + "\n;(async () => { const a = JSON.parse(__args); const v = await " + req.name + "(...a); return JSON.stringify(v === undefined ? '' : v); })()";
    const out = await new vm.Script(src).runInContext(ctx, { timeout: 4000 });
    process.stdout.write(JSON.stringify({ value: out }));
  } catch (e) {
    process.stderr.write(String(e && e.message ? e.message : e));
    process.exit(2);
  }
  clearTimeout(kill);
});
'''

NAME = re.compile(r"@customfunction[\s\S]*?\bfunction\s+([A-Za-z_$][\w$]*)")


class JsUnavailable(Exception):
    pass


class JsError(Exception):
    pass


def node() -> str | None:
    return shutil.which("node")


def status() -> dict:
    exe = node()
    if not exe:
        return {"available": False, "runtime": "", "note": "No JavaScript runtime was found on the PATH. Custom functions are computed in the window only; install Node.js (MIT) to compute them in the engine process too."}
    try:
        v = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        v = ""
    return {"available": True, "runtime": f"node {v}", "note": ""}


def functions(auto: dict) -> dict[str, tuple[str, str]]:
    out = {}
    for s in auto.get("scripts") or []:
        js = s.get("js")
        if not isinstance(js, str):
            continue
        for n in NAME.findall(s.get("code") or ""):
            out[n.upper()] = (n, js)
    return out


def call(js: str, name: str, args: list):
    exe = node()
    if not exe:
        raise JsUnavailable(status()["note"])
    with tempfile.TemporaryDirectory() as d:
        try:
            p = subprocess.run([exe, "--max-old-space-size=192", "-e", RUNNER], input=json.dumps({"js": js, "name": name, "args": args}), capture_output=True, text=True, timeout=TIMEOUT, cwd=d, env={"PATH": "/usr/bin:/bin:/usr/local/bin"})
        except subprocess.TimeoutExpired:
            raise JsError("the function ran longer than 5 seconds")
    if p.returncode != 0:
        raise JsError((p.stderr.strip().splitlines() or ["the function failed"])[-1][:300])
    try:
        return json.loads(json.loads(p.stdout)["value"])
    except (ValueError, KeyError):
        raise JsError("the function returned nothing readable")
