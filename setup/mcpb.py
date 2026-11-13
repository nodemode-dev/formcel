#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "setup", "mcpb", "manifest.json")
SERVER_SOURCE = os.path.join(ROOT, "setup", "mcp_stdio.py")
PACKAGE = os.path.join(ROOT, "frontend", "package.json")
REQUIRED = ("manifest_version", "name", "description", "author", "server")
OUTPUT = "formcel.mcpb"
STAMP = (1980, 1, 1, 0, 0, 0)


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def package_version():
    try:
        return load(PACKAGE).get("version")
    except (OSError, ValueError):
        return None


def problems_found():
    problems = []
    try:
        manifest = load(MANIFEST)
    except (OSError, ValueError) as exc:
        return [f"setup/mcpb/manifest.json cannot be read: {exc}"]
    for key in REQUIRED:
        if key not in manifest or manifest[key] in ("", None, {}):
            problems.append(f"manifest needs {key}")
    if manifest.get("manifest_version") != "0.2":
        problems.append("manifest_version must be 0.2")
    name = manifest.get("name")
    if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", name or ""):
        problems.append("manifest name must be lower-case letters, digits and hyphens")
    version = package_version()
    if not version:
        problems.append("frontend/package.json cannot be read for the version")
    elif "version" in manifest and manifest["version"] != version:
        problems.append(f"manifest version {manifest['version']} differs from package.json {version}; leave it out and the build writes it")
    author = manifest.get("author")
    if not isinstance(author, dict) or not author.get("name"):
        problems.append("manifest author needs a name")
    server = manifest.get("server")
    if not isinstance(server, dict):
        problems.append("manifest server must be an object")
    else:
        if server.get("type") != "python":
            problems.append("server type must be python")
        entry = server.get("entry_point")
        if not isinstance(entry, str) or not entry.startswith("server/"):
            problems.append("server entry_point must be a file under server/")
        elif not os.path.isfile(os.path.join(ROOT, "setup", entry[len("server/"):])):
            problems.append(f"entry point {entry} has no source in setup/")
        config = server.get("mcp_config")
        if not isinstance(config, dict) or not config.get("command") or not isinstance(config.get("args"), list):
            problems.append("server mcp_config needs a command and args")
    return problems


def check():
    problems = problems_found()
    if problems:
        for line in problems:
            print(f"[mcpb] {line}", file=sys.stderr)
        return 1
    print(f"[mcpb] manifest is valid; a build carries version {package_version()} from package.json")
    return 0


def entries():
    manifest = {**load(MANIFEST), "version": package_version()}
    order = ["manifest_version", "name", "display_name", "version"]
    manifest = {**{k: manifest[k] for k in order if k in manifest}, **{k: v for k, v in manifest.items() if k not in order}}
    with open(SERVER_SOURCE, "rb") as f:
        server = f.read()
    return sorted([("manifest.json", (json.dumps(manifest, indent=2) + "\n").encode("utf-8")), ("server/mcp_stdio.py", server)])


def build(folder):
    problems = problems_found()
    if problems:
        for line in problems:
            print(f"[mcpb] {line}", file=sys.stderr)
        return 1
    os.makedirs(folder, exist_ok=True)
    target = os.path.join(folder, OUTPUT)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, data in entries():
            info = zipfile.ZipInfo(name, STAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o644 << 16
            z.writestr(info, data, compresslevel=9)
    print(f"[mcpb] wrote {target}")
    return 0


def main():
    parser = argparse.ArgumentParser(prog="formcel mcpb", description="the Claude Desktop extension")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true", help="validate the manifest")
    group.add_argument("--build", metavar="DIR", help="write formcel.mcpb into DIR")
    args = parser.parse_args()
    return check() if args.check else build(args.build)


if __name__ == "__main__":
    sys.exit(main())
