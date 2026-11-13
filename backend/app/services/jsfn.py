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
    class CfError extends Error { constructor(code, message) { super(message || String(code)); this.excelCode = String(code); } }
    const codes = { invalidValue: "#VALUE!", notAvailable: "#N/A", divisionByZero: "#DIV/0!", invalidNumber: "#NUM!", nullReference: "#NULL!", invalidName: "#NAME?", invalidReference: "#REF!" };
    const ctx = vm.createContext({ console: quiet, CustomFunctions: { Error: CfError, ErrorCode: codes }, __args: JSON.stringify(req.args), setTimeout, setInterval, clearTimeout, clearInterval }, { codeGeneration: { strings: false, wasm: false } });
    for (const k of ["fetch", "WebSocket", "EventSource", "require", "module", "exports"]) delete globalThis[k];
    process.mainModule = undefined;
    process.getBuiltinModule = undefined;
    process.kill = undefined;
    const extra = req.stream ? ", { setResult(v) { last = v; has = true; if (wake) wake(); }, onCanceled: null, address: '' }" : "";
    const hold = req.stream ? "if (!has) await new Promise((res) => { wake = res; setTimeout(res, 3000); });" : "";
    const src = '"use strict";\n' + req.js + "\n;(async () => { const a = JSON.parse(__args); let last, wake, has = false; const v = await " + req.name + "(...a" + extra + "); " + hold + " const r = has ? last : v; return JSON.stringify(r === undefined ? '' : r); })()";
    const out = await new vm.Script(src).runInContext(ctx, { timeout: 4000 });
    process.stdout.write(JSON.stringify({ value: out }), () => process.exit(0));
    return;
  } catch (e) {
    const code = e && e.excelCode ? e.excelCode : "";
    process.stderr.write((code ? "\u0001" + code + "\u0001" : "") + String(e && e.message ? e.message : e));
    process.exit(2);
  }
  clearTimeout(kill);
});
'''

NAME = re.compile(r"@customfunction[\s\S]*?\bfunction\s+([A-Za-z_$][\w$]*)")


class JsUnavailable(Exception):
    pass


class JsError(Exception):
    def __init__(self, message: str, code: str = ""):
        super().__init__(message)
        self.code = code


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


DOCBLOCK = re.compile(r"/\*\*((?:(?!\*/)[\s\S])*?@customfunction(?:(?!\*/)[\s\S])*?)\*/\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)")


def streaming(auto: dict) -> set[str]:
    out = set()
    for s in auto.get("scripts") or []:
        for doc, name in DOCBLOCK.findall(s.get("code") or ""):
            if "@streaming" in doc:
                out.add(name.upper())
        for m in s.get("meta") or []:
            if isinstance(m, dict) and (m.get("options") or {}).get("stream"):
                out.add(str(m.get("name", "")).upper())
    return out


def functions(auto: dict) -> dict[str, tuple[str, str]]:
    out = {}
    for s in auto.get("scripts") or []:
        js = s.get("js")
        if not isinstance(js, str):
            continue
        for n in NAME.findall(s.get("code") or ""):
            out[n.upper()] = (n, js)
    return out


def call(js: str, name: str, args: list, stream: bool = False):
    exe = node()
    if not exe:
        raise JsUnavailable(status()["note"])
    from .gasrun import RunError, child_env, locked_down

    try:
        flags = locked_down(exe)
    except RunError as e:
        raise JsUnavailable(str(e)) from None
    with tempfile.TemporaryDirectory() as d:
        try:
            p = subprocess.run([exe, *flags, "--max-old-space-size=192", "-e", RUNNER], input=json.dumps({"js": js, "name": name, "args": args, "stream": stream}), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=TIMEOUT, cwd=d, env=child_env())
        except subprocess.TimeoutExpired:
            raise JsError("the function ran longer than 5 seconds")
    if p.returncode != 0:
        said = (p.stderr.strip().splitlines() or ["the function failed"])[-1]
        if said.startswith("\u0001") and said.count("\u0001") >= 2:
            _, code, rest = said.split("\u0001", 2)
            raise JsError(rest[:300] or code, code)
        raise JsError(said[:300])
    try:
        return json.loads(json.loads(p.stdout)["value"])
    except (ValueError, KeyError):
        raise JsError("the function returned nothing readable")
