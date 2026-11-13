import os
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

from . import aiclient

UNIT = "formcel-refresh"
LABEL = "ai.nodemode.formcel.refresh"
TASK = "FormCel Refresh"
BACKEND = Path(__file__).resolve().parents[2]


def platform() -> str:
    if sys.platform.startswith("linux"):
        return "linux"
    if sys.platform == "darwin":
        return "macos"
    if sys.platform in ("win32", "cygwin"):
        return "windows"
    return "other"


def home() -> Path:
    return Path(os.environ.get("FORMCEL_SCHED_HOME") or Path.home())


def python_exe() -> str:
    return sys.executable


def command() -> list[str]:
    return [python_exe(), "-m", "app.refresh_cli"]


def env() -> dict:
    from .. import config

    return {"FORMCEL_DATA_DIR": str(config.DATA_DIR), "FORMCEL_PORT": str(config.PORT), "PYTHONPATH": str(BACKEND)}


def systemd_dir() -> Path:
    return home() / ".config" / "systemd" / "user"


def launchd_path() -> Path:
    return home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"


def windows_dir() -> Path:
    return Path(os.environ.get("FORMCEL_DATA_DIR") or home()) / "Schedule"


def quote_unit(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def systemd_files(minutes: int) -> dict[str, str]:
    cmd = " ".join(quote_unit(c) for c in command())
    envs = "\n".join(f"Environment={quote_unit(f'{k}={v}')}" for k, v in env().items())
    service = f"""[Unit]
Description=FormCel refresh of scheduled queries

[Service]
Type=oneshot
WorkingDirectory={BACKEND}
{envs}
ExecStart={cmd}
"""
    timer = f"""[Unit]
Description=Run FormCel query refresh every {minutes} minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec={minutes}min
Persistent=true
Unit={UNIT}.service

[Install]
WantedBy=timers.target
"""
    return {f"{UNIT}.service": service, f"{UNIT}.timer": timer}


def xml_text(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def launchd_plist(minutes: int) -> str:
    args = "".join(f"\n    <string>{xml_text(c)}</string>" for c in command())
    envs = "".join(f"\n    <key>{xml_text(k)}</key><string>{xml_text(v)}</string>" for k, v in env().items())
    from .. import config

    log = xml_text(str(config.DATA_DIR / "refresh.log"))
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{LABEL}</string>
  <key>ProgramArguments</key>
  <array>{args}
  </array>
  <key>WorkingDirectory</key><string>{xml_text(str(BACKEND))}</string>
  <key>EnvironmentVariables</key>
  <dict>{envs}
  </dict>
  <key>StartInterval</key><integer>{minutes * 60}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>{log}</string>
  <key>StandardErrorPath</key><string>{log}</string>
</dict>
</plist>
"""


def windows_files(minutes: int) -> dict[str, str]:
    d = windows_dir()
    exe = python_exe()
    pyw = Path(exe).with_name("pythonw.exe")
    runner = str(pyw if pyw.exists() else exe)
    lines = ["@echo off", f'cd /d "{BACKEND}"'] + [f'set "{k}={v}"' for k, v in env().items()] + [f'"{runner}" -m app.refresh_cli']
    start = datetime.now().replace(second=0, microsecond=0).isoformat(timespec="seconds")
    xml = f"""<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <TimeTrigger>
      <Repetition><Interval>PT{minutes}M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
      <StartBoundary>{start}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{xml_text(str(d / 'refresh.cmd'))}</Command>
    </Exec>
  </Actions>
</Task>
"""
    return {"refresh.cmd": "\r\n".join(lines) + "\r\n", "refresh-task.xml": xml}


def run(cmd: list[str]) -> tuple[bool, str]:
    exe = shutil.which(cmd[0])
    if exe is None:
        return False, f"{cmd[0]} was not found"
    try:
        r = subprocess.run([exe, *cmd[1:]], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError) as e:
        return False, str(e)
    out = (r.stdout + r.stderr).strip()
    return r.returncode == 0, out


def write_all(files: dict[str, str], folder: Path) -> list[str]:
    folder.mkdir(parents=True, exist_ok=True)
    paths = []
    for name, text in files.items():
        p = folder / name
        p.write_text(text, encoding="utf-16" if name.endswith(".xml") else "utf-8")
        paths.append(str(p))
    return paths


def read_state() -> dict:
    s = aiclient.load_settings()
    return s.get("os_schedule") or {}


def save_state(state: dict | None) -> None:
    with aiclient.SETTINGS:
        s = aiclient.load_settings()
        if state:
            s["os_schedule"] = state
        else:
            s.pop("os_schedule", None)
        aiclient.save_settings(s)


def enable(minutes: int, activate: bool = True) -> dict:
    minutes = max(1, min(int(minutes), 1440))
    plat = platform()
    notes: list[str] = []
    active = False
    if plat == "linux":
        paths = write_all(systemd_files(minutes), systemd_dir())
        if activate:
            ok, out = run(["systemctl", "--user", "daemon-reload"])
            if ok:
                ok, out = run(["systemctl", "--user", "enable", "--now", f"{UNIT}.timer"])
            active = ok
            if not ok:
                notes.append(f"The unit files were written but systemd could not start the timer: {out or 'no user systemd session'}. Run systemctl --user enable --now {UNIT}.timer from a normal login session.")
    elif plat == "macos":
        p = launchd_path()
        paths = write_all({p.name: launchd_plist(minutes)}, p.parent)
        if activate:
            run(["launchctl", "unload", str(p)])
            ok, out = run(["launchctl", "load", "-w", str(p)])
            active = ok
            if not ok:
                notes.append(f"The launch agent was written but launchctl could not load it: {out}. Run launchctl load -w {p}.")
    elif plat == "windows":
        paths = write_all(windows_files(minutes), windows_dir())
        if activate:
            ok, out = run(["schtasks", "/Create", "/TN", TASK, "/XML", paths[1], "/F"])
            active = ok
            if not ok:
                notes.append(f"The task files were written but Task Scheduler refused them: {out}. Run schtasks /Create /TN \"{TASK}\" /XML \"{paths[1]}\" /F.")
    else:
        raise ValueError("this system has no supported scheduler")
    state = {"enabled": True, "minutes": minutes, "platform": plat, "files": paths, "active": active, "since": time.time()}
    save_state(state)
    return {**state, "notes": notes}


def disable(activate: bool = True) -> dict:
    plat = platform()
    notes: list[str] = []
    removed: list[str] = []
    if plat == "linux":
        if activate:
            run(["systemctl", "--user", "disable", "--now", f"{UNIT}.timer"])
        for n in (f"{UNIT}.timer", f"{UNIT}.service"):
            p = systemd_dir() / n
            if p.exists():
                p.unlink()
                removed.append(str(p))
        if activate:
            run(["systemctl", "--user", "daemon-reload"])
    elif plat == "macos":
        p = launchd_path()
        if activate:
            run(["launchctl", "unload", str(p)])
        if p.exists():
            p.unlink()
            removed.append(str(p))
    elif plat == "windows":
        if activate:
            run(["schtasks", "/Delete", "/TN", TASK, "/F"])
        for n in ("refresh.cmd", "refresh-task.xml"):
            p = windows_dir() / n
            if p.exists():
                p.unlink()
                removed.append(str(p))
    save_state(None)
    return {"enabled": False, "platform": plat, "removed": removed, "notes": notes}


def status() -> dict:
    st = read_state()
    plat = platform()
    active = False
    if st.get("enabled") and plat == "linux" and shutil.which("systemctl"):
        ok, out = run(["systemctl", "--user", "is-active", f"{UNIT}.timer"])
        active = ok and out.strip() == "active"
    elif st.get("enabled") and plat == "macos" and shutil.which("launchctl"):
        active = run(["launchctl", "list", LABEL])[0]
    elif st.get("enabled") and plat == "windows" and shutil.which("schtasks"):
        active = run(["schtasks", "/Query", "/TN", TASK])[0]
    return {"enabled": bool(st.get("enabled")), "minutes": st.get("minutes", 15), "platform": plat, "files": st.get("files", []), "active": active, "log": str(log_path())}


def log_path() -> Path:
    from .. import config

    return config.DATA_DIR / "refresh.log"


def due_queries(auto: dict, now: float, today: datetime) -> list[str]:
    out = []
    for q in auto.get("queries") or []:
        if not q.get("id"):
            continue
        last = q.get("refreshed") or 0
        every = q.get("every") or 0
        daily = str(q.get("daily") or "")
        if every and every > 0 and now - last >= every * 60 - 5:
            out.append(q["id"])
        elif daily and len(daily) >= 4 and ":" in daily:
            try:
                h, m = daily.split(":")
                at = today.replace(hour=int(h), minute=int(m), second=0, microsecond=0).timestamp()
            except ValueError:
                continue
            if now >= at and last < at:
                out.append(q["id"])
    return out


def engine_alive() -> bool:
    from urllib.request import urlopen

    from .. import config

    try:
        with urlopen(f"http://127.0.0.1:{config.PORT}/api/health", timeout=1.5) as r:
            return r.status == 200
    except OSError:
        return False


def main() -> int:
    from .. import config
    from . import pquery, qgraph, scheduler, webdata
    from .store import store

    config.ensure_data_dir()
    log = log_path()

    def say(text: str) -> None:
        line = f"{datetime.now().isoformat(timespec='seconds')} {text}"
        print(line)
        try:
            with log.open("a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError:
            pass
        try:
            if log.stat().st_size > 512_000:
                log.write_text("\n".join(log.read_text("utf-8").splitlines()[-500:]) + "\n", encoding="utf-8")
        except OSError:
            pass

    if engine_alive():
        say("the FormCel engine process is running and refreshes its own queries; nothing to do")
        return 0
    now = time.time()
    today = datetime.now()
    total = 0
    failed = 0
    for p in sorted(store().dir.glob("*.fcel")):
        try:
            auto = store()._automation(p)
        except Exception:
            continue
        ids = due_queries(auto, now, today)
        if not ids:
            continue
        library = {x["id"]: x for x in (auto.get("queries") or []) if x.get("id")}
        try:
            order = qgraph.refresh_order(library, ids)
        except ValueError as e:
            say(f"{p.stem}: {e}")
            failed += 1
            continue
        for qid in order:
            name = library[qid].get("name") or qid
            try:
                r = scheduler.refresh(p.stem, qid)
                total += 1
                say(f"{p.stem}: refreshed {name} ({r['rows']} rows)")
            except (pquery.QueryError, webdata.FetchError, ValueError, KeyError, FileNotFoundError, OSError) as e:
                failed += 1
                say(f"{p.stem}: {name} failed: {e}")
    if not total and not failed:
        say("no query was due")
    return 1 if failed and not total else 0


if __name__ == "__main__":
    raise SystemExit(main())
