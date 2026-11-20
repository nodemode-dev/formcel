#!/usr/bin/env python3
import argparse
import ast
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, ".claude", "skills")
MIRROR = os.path.join(ROOT, ".agents", "skills")
SKIP_DIRS = {"__pycache__", "node_modules", ".git"}
SKIP_FILES = {".DS_Store"}
RESERVED = ("anthropic", "claude")
TAG = re.compile(r"</?[A-Za-z][^>]*>")
LAUNCHER = "formcel"
LAUNCH = os.path.join(ROOT, "formcel.bat" if os.name == "nt" else "formcel")
ARGS = ["mcp"]
CLIENTS = ("claude", "codex", "cursor")
REGISTRY = "formcel"
MANIFEST = os.path.join(ROOT, "agents", "manifest.json")
MCP_SOURCE = os.path.join(ROOT, "backend", "app", "routers", "mcp.py")
STDIO_SOURCE = os.path.join(ROOT, "setup", "mcp_stdio.py")
DOCK = {"present": True, "positions": ["bottom", "right"], "tabs": ["chat", "shell", "claude", "codex", "cursor", "agent"]}
DOCK_DIR = os.path.join(ROOT, "frontend", "src", "dock")
DOCK_MANIFEST = os.path.join(DOCK_DIR, "MANIFEST.json")


def dock_files():
    names = sorted(n for n in os.listdir(DOCK_DIR) if n != "MANIFEST.json" and os.path.isfile(os.path.join(DOCK_DIR, n)))
    return {n: hashlib.sha256(read_bytes(os.path.join(DOCK_DIR, n))).hexdigest() for n in names}


def check_dock(problems):
    try:
        kept = json.loads(read_bytes(DOCK_MANIFEST).decode("utf-8")).get("files", {})
    except (OSError, ValueError, AttributeError):
        problems.append("frontend/src/dock/MANIFEST.json is missing or not JSON; copy the shared dock module in whole")
        return
    now = dock_files()
    for name in sorted(set(kept) | set(now)):
        if kept.get(name) != now.get(name):
            problems.append(f"frontend/src/dock/{name} does not match MANIFEST.json; the shared dock module is never edited here, only copied in whole")


LOOKUP = os.path.join(ROOT, "backend", "app", "services", "agent_lookup.py")
LOOKUP_REL = "backend/app/services/agent_lookup.py"
LOOKUP_HASHES = {"1.0.0": "252ea9bb9419d4990f174f91914f09800497bc69e98f849f5643bbf4217cc3f3"}


def check_lookup(problems):
    try:
        raw = read_bytes(LOOKUP)
    except OSError:
        problems.append(f"{LOOKUP_REL}: missing (the shared finder for the agent programs)")
        return
    said = re.search(rb'^VERSION = "([^"\r\n]+)"\r?$', raw, re.M)
    version = said.group(1).decode("ascii", "replace") if said else "unknown"
    if LOOKUP_HASHES.get(version) != hashlib.sha256(raw).hexdigest():
        problems.append(f"{LOOKUP_REL}: does not match the hash recorded for version {version} (the shared finder changes only as a whole new version)")


def lookup():
    import importlib.util
    spec = importlib.util.spec_from_file_location("formcel_agent_lookup", LOOKUP)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def files_under(base):
    found = {}
    if not os.path.isdir(base):
        return found
    for folder, dirs, names in os.walk(base):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for name in sorted(names):
            if name in SKIP_FILES or name.endswith(".pyc"):
                continue
            full = os.path.join(folder, name)
            found[os.path.relpath(full, base).replace(os.sep, "/")] = full
    return found


def read_bytes(path):
    with open(path, "rb") as f:
        return f.read()


def is_bad_char(cp):
    return cp == 0x2014 or 0x1F000 <= cp <= 0x1FAFF or 0x2600 <= cp <= 0x27BF or cp == 0xFE0F


def frontmatter(text):
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return None
    values = {}
    for line in lines[1:]:
        if line.strip() == "---":
            return values
        found = re.match(r"^([A-Za-z_-]+):\s*(.*)$", line)
        if found:
            value = found.group(2).strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[found.group(1)] = value
    return None


def skill_names():
    return sorted(d for d in os.listdir(SOURCE) if os.path.isdir(os.path.join(SOURCE, d))) if os.path.isdir(SOURCE) else []


def served_mcp():
    with open(MCP_SOURCE, encoding="utf-8") as f:
        tree = ast.parse(f.read())
    tools, http = [], False
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "TOOLS" for t in node.targets):
            tools = ast.literal_eval(node.value)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for deco in node.decorator_list:
                if isinstance(deco, ast.Call) and isinstance(deco.func, ast.Attribute) and deco.func.attr == "post" and deco.args and ast.literal_eval(deco.args[0]) == "/mcp":
                    http = True
    return tools, http


def build_manifest():
    tools, http = served_mcp()
    names = [t["name"] for t in tools]
    read_only = [t["name"] for t in tools if (t.get("annotations") or {}).get("readOnlyHint") is True]
    stdio = os.path.isfile(STDIO_SOURCE) and "mcp_stdio.py" in read_bytes(os.path.join(ROOT, LAUNCHER)).decode("utf-8", errors="replace")
    transports = (["stdio"] if stdio else []) + (["http"] if http else [])
    mcp = {"tools": names, "read_only": read_only, "approval_gated": [n for n in names if n not in read_only], "transports": transports} if names and transports else None
    skills = []
    for skill in skill_names():
        nested = os.path.join(SOURCE, skill, "sub-skills")
        subs = sorted(d for d in os.listdir(nested) if os.path.isdir(os.path.join(nested, d))) if os.path.isdir(nested) else []
        skills.append({"name": skill, "sub_skills": subs})
    return {"format": "form-agent-manifest", "version": 1, "app": REGISTRY, "mcp": mcp, "skills": skills, "dock": DOCK, "extensions": None}


def manifest_text():
    return json.dumps(build_manifest(), indent=2, ensure_ascii=False) + "\n"


def check_manifest(problems):
    try:
        want = manifest_text()
    except (OSError, SyntaxError, ValueError) as exc:
        problems.append(f"agents/manifest.json cannot be built: {exc}")
        return
    try:
        have = read_bytes(MANIFEST).decode("utf-8")
    except OSError:
        problems.append("agents/manifest.json is missing; run ./formcel agents sync")
        return
    if have != want:
        problems.append("agents/manifest.json is not what the sync writes; run ./formcel agents sync")


def sync_manifest():
    try:
        want = manifest_text()
    except (OSError, SyntaxError, ValueError) as exc:
        print(f"[agents] agents/manifest.json cannot be built: {exc}", file=sys.stderr)
        return 1
    problems = []
    check_manifest(problems)
    if problems:
        os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
        with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
            f.write(want)
        print("[agents] wrote agents/manifest.json")
    else:
        print("[agents] agents/manifest.json is current")
    return 0


def sync():
    if not os.path.isdir(SOURCE):
        print("[agents] .claude/skills is missing", file=sys.stderr)
        return 1
    source = files_under(SOURCE)
    mirror = files_under(MIRROR)
    changed = 0
    for rel in sorted(mirror):
        if rel not in source:
            os.remove(mirror[rel])
            print(f"[agents] removed {rel}")
            changed += 1
    for rel in sorted(source):
        target = os.path.join(MIRROR, rel)
        if rel in mirror and read_bytes(mirror[rel]) == read_bytes(source[rel]):
            continue
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copyfile(source[rel], target)
        print(f"[agents] wrote {rel}")
        changed += 1
    for folder, dirs, names in os.walk(MIRROR, topdown=False):
        if folder != MIRROR and not os.listdir(folder):
            os.rmdir(folder)
    print(f"[agents] .agents/skills mirrors .claude/skills ({len(source)} files, {changed} changed)")
    problems = []
    check_dock(problems)
    check_lookup(problems)
    for line in problems:
        print(f"[agents] {line}", file=sys.stderr)
    return sync_manifest() or (1 if problems else 0)


def check_drift(problems):
    source = files_under(SOURCE)
    mirror = files_under(MIRROR)
    for rel in sorted(set(source) | set(mirror)):
        if rel not in mirror:
            problems.append(f".agents/skills/{rel} is missing; run ./{LAUNCHER} agents sync")
        elif rel not in source:
            problems.append(f".agents/skills/{rel} is stale; run ./{LAUNCHER} agents sync")
        elif read_bytes(source[rel]) != read_bytes(mirror[rel]):
            problems.append(f".agents/skills/{rel} differs from .claude/skills; run ./{LAUNCHER} agents sync")


def check_skill_format(problems):
    if not os.path.isdir(SOURCE):
        problems.append(".claude/skills is missing")
        return
    skills = skill_names()
    if not skills:
        problems.append(".claude/skills holds no skill folder")
    for skill in skills:
        path = os.path.join(SOURCE, skill, "SKILL.md")
        label = f".claude/skills/{skill}/SKILL.md"
        if not os.path.isfile(path):
            problems.append(f"{label} is missing")
            continue
        text = read_bytes(path).decode("utf-8", errors="replace")
        if len(text.split("\n")) - (1 if text.endswith("\n") else 0) >= 500:
            problems.append(f"{label} has 500 lines or more")
        meta = frontmatter(text)
        if meta is None:
            problems.append(f"{label} has no frontmatter")
            continue
        name = meta.get("name", "")
        description = meta.get("description", "")
        if not name:
            problems.append(f"{label} has no name")
        else:
            if len(name) > 64:
                problems.append(f"{label} name is longer than 64 characters")
            if name != skill:
                problems.append(f"{label} name '{name}' does not match its folder '{skill}'")
            if any(word in name.lower() for word in RESERVED):
                problems.append(f"{label} name holds a reserved word")
            if TAG.search(name):
                problems.append(f"{label} name holds an XML tag")
        if not description:
            problems.append(f"{label} has no description")
        else:
            if len(description) > 1024:
                problems.append(f"{label} description is longer than 1024 characters")
            if TAG.search(description):
                problems.append(f"{label} description holds an XML tag")
    for rel, full in sorted(files_under(SOURCE).items()):
        try:
            text = read_bytes(full).decode("utf-8")
        except UnicodeDecodeError:
            continue
        for ch in text:
            if is_bad_char(ord(ch)):
                problems.append(f".claude/skills/{rel} holds U+{ord(ch):04X}")
                break


def load_json(rel, problems):
    path = os.path.join(ROOT, rel)
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except OSError:
        problems.append(f"{rel} is missing")
    except ValueError as exc:
        problems.append(f"{rel} is not valid JSON: {exc}")
    return None


def check_server(rel, server, problems):
    if not isinstance(server, dict):
        problems.append(f"{rel} has no {LAUNCHER} server")
        return
    command = server.get("command")
    args = server.get("args") or []
    if not isinstance(command, str) or not isinstance(args, list):
        problems.append(f"{rel} server needs a command and an args list")
        return
    if command == "sh":
        joined = " ".join(str(a) for a in args)
        if LAUNCHER not in joined or not joined.rstrip().rstrip('"').endswith("mcp"):
            problems.append(f"{rel} must run the {LAUNCHER} launcher with mcp")
        return
    if os.path.basename(command) != LAUNCHER or args != ["mcp"]:
        problems.append(f"{rel} must name the {LAUNCHER} launcher with the argument mcp")


def check_codex(problems):
    path = os.path.join(ROOT, ".codex", "config.toml")
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError:
        problems.append(".codex/config.toml is missing")
        return
    try:
        import tomllib
    except ImportError:
        text = raw.decode("utf-8", errors="replace")
        if f"[mcp_servers.{LAUNCHER}]" not in text or f"/{LAUNCHER}\\\" mcp" not in text:
            problems.append(f".codex/config.toml must run the {LAUNCHER} launcher with mcp")
        return
    try:
        toml = tomllib.loads(raw.decode("utf-8"))
    except (tomllib.TOMLDecodeError, UnicodeDecodeError) as exc:
        problems.append(f".codex/config.toml is not valid TOML: {exc}")
        return
    check_server(".codex/config.toml", (toml.get("mcp_servers") or {}).get(LAUNCHER), problems)


def check_agent_files(problems):
    config = load_json(".mcp.json", problems)
    if config is not None:
        check_server(".mcp.json", (config.get("mcpServers") or {}).get(LAUNCHER), problems)
    config = load_json(".cursor/mcp.json", problems)
    if config is not None:
        check_server(".cursor/mcp.json", (config.get("mcpServers") or {}).get(LAUNCHER), problems)
    check_codex(problems)
    plugin = load_json(".claude-plugin/plugin.json", problems)
    if plugin is not None:
        skills = plugin.get("skills")
        if not isinstance(skills, list) or not skills:
            problems.append(".claude-plugin/plugin.json lists no skills")
        else:
            for entry in skills:
                target = os.path.normpath(os.path.join(ROOT, str(entry)))
                if not os.path.isfile(os.path.join(target, "SKILL.md")):
                    problems.append(f".claude-plugin/plugin.json skills path {entry} has no SKILL.md")
        check_server(".claude-plugin/plugin.json", (plugin.get("mcpServers") or {}).get(LAUNCHER), problems)


def check():
    problems = []
    check_drift(problems)
    check_skill_format(problems)
    check_agent_files(problems)
    check_manifest(problems)
    check_dock(problems)
    check_lookup(problems)
    if problems:
        for line in problems:
            print(f"[agents] {line}", file=sys.stderr)
        print(f"[agents] {len(problems)} problem(s)", file=sys.stderr)
        return 1
    print("[agents] clean: mirror matches, skills pass the format gate, MCP configs name the launcher, manifest is current, the dock module matches its MANIFEST.json, the agent finder matches its recorded hash")
    return 0


def backup(path, dry):
    if os.path.exists(path) and not dry:
        shutil.copy2(path, f"{path}.bak-{time.strftime('%Y%m%d-%H%M%S')}")


def copy_skills(root, dry, said):
    for name in skill_names():
        source = os.path.join(SOURCE, name)
        target = os.path.join(root, name)
        theirs = files_under(target)
        ours = files_under(source)
        if theirs.keys() == ours.keys() and all(read_bytes(theirs[k]) == read_bytes(ours[k]) for k in ours):
            said.append(f"  skill already at {target}")
            continue
        said.append(f"  skill -> {target}")
        if not dry:
            shutil.rmtree(target, ignore_errors=True)
            os.makedirs(root, exist_ok=True)
            shutil.copytree(source, target)


def install_claude(home, dry, said):
    said.append("Claude Code:")
    finder = lookup()
    found = finder.check(finder.find("claude", override_vars=("FORMCEL_CLAUDE_BIN",), home=home))
    claude = found.path if found.state == "runs" else None
    line = subprocess.list2cmdline([LAUNCH, *ARGS])
    if claude:
        env = finder.child_env(claude, home=home)
        have = finder.run([claude, "mcp", "get", LAUNCHER], env, 60)
        if have.returncode == 0 and LAUNCH in have.stdout:
            said.append(f"  MCP server {LAUNCHER} already set (user scope)")
        else:
            said.append(f"  claude mcp add --scope user {LAUNCHER} -- {line}")
            if not dry:
                if have.returncode == 0:
                    finder.run([claude, "mcp", "remove", LAUNCHER, "--scope", "user"], env, 60)
                finder.run([claude, "mcp", "add", "--scope", "user", LAUNCHER, "--", LAUNCH, *ARGS], env, 60).check_returncode()
    else:
        said.append(f"  {finder.sentence(found, finder.install('claude'))} Once it runs: claude mcp add --scope user {LAUNCHER} -- {line}")
    copy_skills(os.path.join(home, ".claude", "skills"), dry, said)


def install_codex(home, dry, said):
    said.append("Codex:")
    cfg = os.path.join(os.environ.get("CODEX_HOME") or os.path.join(home, ".codex"), "config.toml")
    block = f"[mcp_servers.{LAUNCHER}]\ncommand = {json.dumps(LAUNCH, ensure_ascii=False)}\nargs = {json.dumps(ARGS)}\nstartup_timeout_sec = 90\ntool_timeout_sec = 600\n"
    text = open(cfg, encoding="utf-8").read() if os.path.exists(cfg) else ""
    found = re.search(rf"(?ms)^\[mcp_servers\.{LAUNCHER}\]\n.*?(?=^\[|\Z)", text)
    if found and found.group(0).strip() == block.strip():
        said.append(f"  MCP server {LAUNCHER} already in {cfg}")
    else:
        said.append(f"  MCP server {LAUNCHER} -> {cfg}")
        if not dry:
            backup(cfg, dry)
            os.makedirs(os.path.dirname(cfg), exist_ok=True)
            new = text[:found.start()] + block + "\n" + text[found.end():] if found else (text.rstrip("\n") + "\n\n" if text.strip() else "") + block
            with open(cfg, "w", encoding="utf-8") as f:
                f.write(new)
    copy_skills(os.path.join(home, ".agents", "skills"), dry, said)


def install_cursor(home, dry, said):
    said.append("Cursor:")
    cfg = os.path.join(home, ".cursor", "mcp.json")
    raw = open(cfg, encoding="utf-8").read() if os.path.exists(cfg) else ""
    data = json.loads(raw) if raw.strip() else {}
    entry = {"command": LAUNCH, "args": ARGS}
    if (data.get("mcpServers") or {}).get(LAUNCHER) == entry:
        said.append(f"  MCP server {LAUNCHER} already in {cfg}")
    else:
        said.append(f"  MCP server {LAUNCHER} -> {cfg}")
        if not dry:
            backup(cfg, dry)
            data.setdefault("mcpServers", {})[LAUNCHER] = entry
            os.makedirs(os.path.dirname(cfg), exist_ok=True)
            with open(cfg, "w", encoding="utf-8") as f:
                f.write(json.dumps(data, indent=2) + "\n")
    copy_skills(os.path.join(home, ".agents", "skills"), dry, said)


def install(clients, dry):
    home, said = os.environ.get("HOME") or os.path.expanduser("~"), []
    for client in clients or CLIENTS:
        {"claude": install_claude, "codex": install_codex, "cursor": install_cursor}[client](home, dry, said)
    print(("Would do (dry run):\n" if dry else "") + "\n".join(said))
    if not dry:
        print("\nRestart the clients. The first command an outside agent runs asks you once, in the FormCel window, to allow outside agents.")
    return 0


def main():
    parser = argparse.ArgumentParser(prog=f"{LAUNCHER} agents", description="the agents kit")
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("sync", help="mirror .claude/skills into .agents/skills").add_argument("--check", action="store_true", help="only check, as agents check does")
    sub.add_parser("check", help="check the mirror, the skills and the MCP configs")
    put = sub.add_parser("install", help="register FormCel with Claude Code, Codex and Cursor for this user")
    put.add_argument("clients", nargs="*", metavar="client", help="claude, codex or cursor (default all three)")
    put.add_argument("--dry-run", action="store_true", help="say what would change and change nothing")
    args = parser.parse_args()
    if args.action == "install":
        bad = [c for c in args.clients if c not in CLIENTS]
        if bad:
            parser.error(f"unknown client {', '.join(bad)} (claude, codex or cursor)")
        return install(args.clients, args.dry_run)
    return check() if args.action == "check" or args.check else sync()


if __name__ == "__main__":
    sys.exit(main())
