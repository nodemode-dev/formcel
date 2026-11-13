import os
from pathlib import Path

HOST = os.environ.get("FORMCEL_HOST", "127.0.0.1")
PORT = int(os.environ.get("FORMCEL_PORT", "8199"))
LAN_PORT = int(os.environ.get("FORMCEL_LAN_PORT", "8200"))
WEB_PORT = int(os.environ.get("FORMCEL_WEB_PORT", "5199"))
PREVIEW_PORT = 5299


def window_origins() -> list[str]:
    raw = os.environ.get("FORMCEL_WINDOW_ORIGINS")
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]
    pages = [f"http://{host}:{port}" for port in (WEB_PORT, PREVIEW_PORT) for host in ("localhost", "127.0.0.1")]
    return pages + ["tauri://localhost", "http://tauri.localhost"]
DATA_DIR = Path(os.environ.get("FORMCEL_DATA_DIR", Path.home() / "FormCel")).expanduser()
WINDOW_DIR = Path(os.environ["FORMCEL_WINDOW_DIR"]).expanduser() if os.environ.get("FORMCEL_WINDOW_DIR") else None
REPO_DIR = Path(__file__).resolve().parents[2]
SUBDIRS = ("Workbooks", "Templates", "Media", "Exports", "Trash")


def ensure_data_dir() -> Path:
    for name in SUBDIRS:
        (DATA_DIR / name).mkdir(parents=True, exist_ok=True)
    return DATA_DIR
